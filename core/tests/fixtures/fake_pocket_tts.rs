//! Binário `pocket-tts` falso para testes headless sem rede nem modelo real (#79).
use std::{
    fs::File,
    io::{Read, Write},
    path::PathBuf,
};

fn write_wav(path: &PathBuf, duration_ms: u64) {
    let sample_rate: u32 = 24_000;
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let num_samples = (u64::from(sample_rate) * duration_ms / 1000).max(1) as u32;
    let data_bytes = num_samples * u32::from(channels) * u32::from(bits_per_sample / 8);
    let mut f = File::create(path).expect("create fake wav");
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_bytes).to_le_bytes()).unwrap();
    f.write_all(b"WAVE").unwrap();
    f.write_all(b"fmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&channels.to_le_bytes()).unwrap();
    f.write_all(&sample_rate.to_le_bytes()).unwrap();
    let byte_rate = sample_rate * u32::from(channels) * u32::from(bits_per_sample / 8);
    f.write_all(&byte_rate.to_le_bytes()).unwrap();
    let block_align = channels * (bits_per_sample / 8);
    f.write_all(&block_align.to_le_bytes()).unwrap();
    f.write_all(&bits_per_sample.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_bytes.to_le_bytes()).unwrap();
    let zeros = vec![0u8; data_bytes as usize];
    f.write_all(&zeros).unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--version") {
        println!("pocket-tts 3.3.0");
        return;
    }
    if args.get(1).map(String::as_str) != Some("generate") {
        eprintln!("unsupported subcommand");
        std::process::exit(2);
    }

    if let Ok(sleep_ms) = std::env::var("CLIPES_FAKE_TTS_SLEEP_MS") {
        if let Ok(ms) = sleep_ms.parse::<u64>() {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
    }
    if std::env::var_os("CLIPES_FAKE_TTS_FAIL").is_some() {
        eprintln!("simulated pocket-tts failure");
        std::process::exit(1);
    }

    let mut text = String::new();
    let mut voice: Option<String> = None;
    let mut config: Option<String> = None;
    let mut output: Option<PathBuf> = None;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--text" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    if v == "-" {
                        std::io::stdin().read_to_string(&mut text).unwrap();
                    } else {
                        text = v.clone();
                    }
                }
            }
            "--voice" => {
                i += 1;
                voice = args.get(i).cloned();
            }
            "--config" => {
                i += 1;
                config = args.get(i).cloned();
            }
            "--output-path" => {
                i += 1;
                output = args.get(i).map(PathBuf::from);
            }
            _ => {}
        }
        i += 1;
    }

    if let Some(cfg) = config {
        if !std::path::Path::new(&cfg).is_file() {
            eprintln!("missing config: {cfg}");
            std::process::exit(1);
        }
    }
    if let Some(v) = voice {
        if !std::path::Path::new(&v).is_file() {
            eprintln!("missing voice: {v}");
            std::process::exit(1);
        }
    }
    let out = output.unwrap_or_else(|| PathBuf::from("tts_output.wav"));
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    let duration_ms = std::env::var("CLIPES_FAKE_TTS_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or_else(|| (text.trim().chars().count() as u64 * 40).max(400));
    write_wav(&out, duration_ms);
}
