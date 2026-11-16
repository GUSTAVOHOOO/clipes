//! Pure-Rust TrueType/OpenType `cmap` coverage reader with in-memory caching for bundled fonts.
use std::sync::OnceLock;

/// Sorted, non-overlapping inclusive ranges of Unicode codepoints mapped to non-zero glyph IDs.
#[derive(Clone, Debug)]
pub struct FontCoverage {
    ranges: Vec<(u32, u32)>,
}

fn u16_be(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn i16_be(data: &[u8], offset: usize) -> Option<i16> {
    let bytes = data.get(offset..offset.checked_add(2)?)?;
    Some(i16::from_be_bytes([bytes[0], bytes[1]]))
}

fn u32_be(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn push_range(ranges: &mut Vec<(u32, u32)>, start: u32, end: u32) {
    if start > end {
        return;
    }
    if let Some(last) = ranges.last_mut() {
        if start <= last.1.saturating_add(1) {
            last.1 = last.1.max(end);
            return;
        }
    }
    ranges.push((start, end));
}

fn parse_format4(sub: &[u8], out: &mut Vec<(u32, u32)>) -> Option<()> {
    let length = u16_be(sub, 2)? as usize;
    let sub = sub.get(..length)?;
    let seg_count_x2 = u16_be(sub, 6)? as usize;
    if (seg_count_x2 & 1) != 0 {
        return None;
    }
    let seg_count = seg_count_x2 / 2;
    let end_off = 14usize;
    let start_off = end_off.checked_add(seg_count_x2)?.checked_add(2)?;
    let delta_off = start_off.checked_add(seg_count_x2)?;
    let range_off = delta_off.checked_add(seg_count_x2)?;
    let _ = sub.get(..range_off.checked_add(seg_count_x2)?)?;

    for i in 0..seg_count {
        let end = u16_be(sub, end_off + i * 2)?;
        let start = u16_be(sub, start_off + i * 2)?;
        if start == 0xFFFF && end == 0xFFFF {
            continue;
        }
        if start > end {
            return None;
        }
        let delta = i16_be(sub, delta_off + i * 2)?;
        let id_range_offset = u16_be(sub, range_off + i * 2)?;

        if id_range_offset == 0 {
            let mut run_start: Option<u32> = None;
            for c in start..=end {
                let gid = (c as i32 + delta as i32) as u16;
                if gid != 0 {
                    run_start.get_or_insert(u32::from(c));
                } else if let Some(rs) = run_start.take() {
                    out.push((rs, u32::from(c) - 1));
                }
            }
            if let Some(rs) = run_start {
                out.push((rs, u32::from(end)));
            }
        } else {
            let mut run_start: Option<u32> = None;
            for c in start..=end {
                let addr = range_off
                    .checked_add(i * 2)?
                    .checked_add(usize::from(id_range_offset))?
                    .checked_add(usize::from(c - start) * 2)?;
                let raw_gid = u16_be(sub, addr)?;
                let gid = if raw_gid != 0 {
                    (raw_gid as i32 + delta as i32) as u16
                } else {
                    0
                };
                if gid != 0 {
                    run_start.get_or_insert(u32::from(c));
                } else if let Some(rs) = run_start.take() {
                    out.push((rs, u32::from(c) - 1));
                }
            }
            if let Some(rs) = run_start {
                out.push((rs, u32::from(end)));
            }
        }
    }
    Some(())
}

fn parse_format12(sub: &[u8], out: &mut Vec<(u32, u32)>) -> Option<()> {
    let length = u32_be(sub, 4)? as usize;
    let sub = sub.get(..length)?;
    let num_groups = u32_be(sub, 12)? as usize;
    let groups_end = 16usize.checked_add(num_groups.checked_mul(12)?)?;
    let _ = sub.get(..groups_end)?;

    for i in 0..num_groups {
        let base = 16 + i * 12;
        let start_char = u32_be(sub, base)?;
        let end_char = u32_be(sub, base + 4)?;
        let start_glyph = u32_be(sub, base + 8)?;
        if start_char > end_char {
            continue;
        }
        if start_glyph == 0 {
            if start_char < end_char {
                out.push((start_char + 1, end_char));
            }
        } else {
            out.push((start_char, end_char));
        }
    }
    Some(())
}

impl FontCoverage {
    /// Parses the Unicode `cmap` subtables from raw TTF/OTF bytes.
    pub fn from_ttf(data: &[u8]) -> Option<Self> {
        let num_tables = u16_be(data, 4)? as usize;
        let records_end = 12usize.checked_add(num_tables.checked_mul(16)?)?;
        let _ = data.get(..records_end)?;

        let mut cmap_slice = None;
        for i in 0..num_tables {
            let rec = 12 + i * 16;
            if data.get(rec..rec + 4)? == b"cmap" {
                let offset = u32_be(data, rec + 8)? as usize;
                let length = u32_be(data, rec + 12)? as usize;
                cmap_slice = Some(data.get(offset..offset.checked_add(length)?)?);
                break;
            }
        }
        let cmap = cmap_slice?;
        let num_subtables = u16_be(cmap, 2)? as usize;
        let sub_records_end = 4usize.checked_add(num_subtables.checked_mul(8)?)?;
        let _ = cmap.get(..sub_records_end)?;

        let mut raw_ranges = Vec::new();
        let mut parsed_any = false;
        for i in 0..num_subtables {
            let rec = 4 + i * 8;
            let platform_id = u16_be(cmap, rec)?;
            let encoding_id = u16_be(cmap, rec + 2)?;
            let sub_offset = u32_be(cmap, rec + 4)? as usize;
            let is_unicode =
                platform_id == 0 || (platform_id == 3 && matches!(encoding_id, 1 | 10));
            if !is_unicode {
                continue;
            }
            let Some(sub) = cmap.get(sub_offset..) else {
                continue;
            };
            let Some(format) = u16_be(sub, 0) else {
                continue;
            };
            let ok = match format {
                4 => parse_format4(sub, &mut raw_ranges).is_some(),
                12 => parse_format12(sub, &mut raw_ranges).is_some(),
                _ => false,
            };
            parsed_any |= ok;
        }
        if !parsed_any {
            return None;
        }
        raw_ranges.sort_unstable();
        let mut merged = Vec::with_capacity(raw_ranges.len());
        for (start, end) in raw_ranges {
            push_range(&mut merged, start, end);
        }
        Some(Self { ranges: merged })
    }

    /// Returns `true` if `ch` maps to a non-zero glyph ID in the parsed `cmap`.
    pub fn contains(&self, ch: char) -> bool {
        let cp = ch as u32;
        self.ranges
            .binary_search_by(|&(start, end)| {
                if cp < start {
                    std::cmp::Ordering::Greater
                } else if cp > end {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .is_ok()
    }
}

static SANS_CMAP: OnceLock<Option<FontCoverage>> = OnceLock::new();
static SERIF_CMAP: OnceLock<Option<FontCoverage>> = OnceLock::new();

/// Returns cached coverage for the bundled fonts, or parses arbitrary font bytes on demand.
pub fn coverage_for(font_bytes: &[u8]) -> Option<std::borrow::Cow<'_, FontCoverage>> {
    if std::ptr::eq(font_bytes, super::render::FONT_BYTES) {
        return SANS_CMAP
            .get_or_init(|| FontCoverage::from_ttf(super::render::FONT_BYTES))
            .as_ref()
            .map(std::borrow::Cow::Borrowed);
    }
    if std::ptr::eq(font_bytes, super::render::SERIF_FONT_BYTES) {
        return SERIF_CMAP
            .get_or_init(|| FontCoverage::from_ttf(super::render::SERIF_FONT_BYTES))
            .as_ref()
            .map(std::borrow::Cow::Borrowed);
    }
    FontCoverage::from_ttf(font_bytes).map(std::borrow::Cow::Owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_fonts_parse_and_cover_expected_scripts() {
        for bytes in [
            crate::export::render::FONT_BYTES,
            crate::export::render::SERIF_FONT_BYTES,
        ] {
            let cov = coverage_for(bytes).expect("bundled TTF cmap must parse");
            for ch in ['a', 'ç', 'ã', '(', ')', '/', ' ', 'Ω', 'Т', 'Д'] {
                assert!(cov.contains(ch), "expected glyph for {ch:?}");
            }
            for ch in ['来', 'エ', '돼', '｛', '｝', '＼'] {
                assert!(!cov.contains(ch), "unexpected glyph for {ch:?}");
            }
        }
    }

    #[test]
    fn malformed_bytes_fail_closed_without_panic() {
        assert!(FontCoverage::from_ttf(&[]).is_none());
        assert!(FontCoverage::from_ttf(b"not a ttf").is_none());
    }
}
