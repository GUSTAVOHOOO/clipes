//! Testes puros do chat (#151). Todo texto, nome e ID de autor aqui é inventado.
use super::*;

fn msg(second: i64, author: &str, text: &str) -> ChatMessage {
    ChatMessage {
        offset_us: second * 1_000_000,
        author: author.into(),
        text: text.into(),
        paid: false,
    }
}

fn series_of(messages: &[ChatMessage]) -> (Vec<Interval>, u64) {
    let mut aggregator = Aggregator::new(INTERVAL_US);
    for m in messages {
        aggregator.push(m);
    }
    aggregator.finish()
}

fn sentence(id: i64, start_s: i64, end_s: i64) -> Sentence {
    Sentence {
        id,
        first_position: 0,
        last_position: 0,
        start_us: start_s * 1_000_000,
        end_us: end_s * 1_000_000,
        language: None,
        text: "texto".into(),
    }
}

#[test]
fn parses_the_real_replay_shape_with_text_emoji_and_super_chat() {
    let text = r#"{"replayChatItemAction":{"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"message":{"runs":[{"text":"oi "},{"emoji":{"emojiId":"UCfake/abc","shortcuts":[":KEKW:"]}}]},"authorExternalChannelId":"UCautor1"}}}}],"videoOffsetTimeMsec":"12500"},"videoOffsetTimeMsec":"12500"}"#;
    let got = parse_line(text);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].offset_us, 12_500_000);
    assert_eq!(got[0].author, "UCautor1");
    assert!(got[0].text.contains("oi") && got[0].text.contains(":KEKW:"));
    assert!(!got[0].paid);

    let paid = r#"{"replayChatItemAction":{"actions":[{"addChatItemAction":{"item":{"liveChatPaidMessageRenderer":{"purchaseAmountText":{"simpleText":"R$ 10,00"},"authorExternalChannelId":"UCautor2"}}}}],"videoOffsetTimeMsec":"30000"}}"#;
    let got = parse_line(paid);
    assert_eq!(got.len(), 1);
    assert!(got[0].paid && got[0].text.is_empty());

    // Linhas que não são mensagem de texto ou Super Chat, quebradas ou sem autor: nada.
    assert!(parse_line("não é json").is_empty());
    assert!(parse_line(r#"{"replayChatItemAction":{"actions":[{"removeChatItemAction":{}}],"videoOffsetTimeMsec":"1"}}"#).is_empty());
    assert!(parse_line(r#"{"replayChatItemAction":{"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"message":{"simpleText":"oi"}}}}}],"videoOffsetTimeMsec":"1"}}"#).is_empty());
}

#[test]
fn classifies_the_three_reactions() {
    assert_eq!(reactions("KKKKKK"), (true, false, false));
    assert_eq!(reactions("kk"), (false, false, false));
    assert_eq!(reactions("kkkk muito bom"), (true, false, false));
    assert_eq!(reactions(" :KEKW: "), (true, false, false));
    assert_eq!(reactions("hahaha"), (true, false, false));
    assert_eq!(reactions("????"), (false, true, false));
    assert_eq!(reactions("o que??"), (false, false, false));
    assert_eq!(reactions("WTF"), (false, true, false));
    assert_eq!(reactions("CLIPA ISSO"), (false, false, true));
    assert_eq!(reactions("clip it!"), (false, false, true));
    assert_eq!(reactions("bom dia pessoal"), (false, false, false));
    // Uma palavra comum que contém as letras de um sinal não conta.
    assert_eq!(reactions("alok lollipop"), (false, false, false));
}

#[test]
fn cleaning_drops_commands_and_repeats_and_counts_distinct_people() {
    let (series, kept) = series_of(&[
        msg(1, "a", "oi"),
        msg(2, "a", "outra coisa"),
        msg(3, "b", "!sorteio"),
        msg(3, "c", "  !pix "),
        // spam do mesmo autor: só a primeira vale, e cada repetição renova a janela
        msg(4, "d", "kkkk"),
        msg(10, "d", "KKKK"),
        msg(50, "d", "kkkk"),
        msg(200, "d", "kkkk"),
        // outro autor, mesma mensagem: vale
        msg(5, "e", "kkkk"),
    ]);
    // mantidas: a(2) + d@4 + e + d@200 (150 s depois da última repetição, fora da janela) = 5
    assert_eq!(kept, 5);
    assert_eq!(series[0].messages, 4);
    assert_eq!(series[0].people, 3, "a, d e e: pessoas, não mensagens");
    assert_eq!(series[0].laugh, 2);
    assert_eq!(series[20].messages, 1);
    assert_eq!(series.len(), 21);
}

#[test]
fn super_chat_counts_even_without_text_and_negative_offsets_are_dropped() {
    let mut paid = msg(5, "a", "");
    paid.paid = true;
    let (series, kept) = series_of(&[paid, msg(-3, "b", "pré-live")]);
    assert_eq!(kept, 1);
    assert_eq!((series[0].paid, series[0].people), (1, 1));
}

fn flat(people: u32, intervals: usize) -> Vec<Interval> {
    vec![
        Interval {
            people,
            messages: people,
            ..Interval::default()
        };
        intervals
    ]
}

#[test]
fn a_raid_is_a_peak_against_the_sources_own_median() {
    let mut series = flat(3, 360);
    for x in &mut series[180..183] {
        x.people = 14;
        x.messages = 40;
    }
    let found = peaks(&series, INTERVAL_US);
    assert_eq!(found.iter().map(|p| p.interval).collect::<Vec<_>>(), [180, 181, 182]);
    assert_eq!(found[0].ratio_tenths, 47);
}

#[test]
fn the_same_absolute_count_is_a_peak_in_a_quiet_source_and_not_in_a_busy_one() {
    let mut quiet = flat(2, 200);
    quiet[100].people = 5;
    assert_eq!(peaks(&quiet, INTERVAL_US).len(), 1);
    let mut busy = flat(20, 200);
    busy[100].people = 5;
    assert!(peaks(&busy, INTERVAL_US).is_empty());
    let mut busy = flat(20, 200);
    busy[100].people = 41;
    assert_eq!(peaks(&busy, INTERVAL_US).len(), 1);
}

#[test]
fn noise_floor_and_threshold_edges() {
    // Chat quase mudo: dupla de pessoas não é pico (piso de ruído), mesmo com mediana 0.
    let mut silent = flat(0, 100);
    silent[50].people = 3;
    assert!(peaks(&silent, INTERVAL_US).is_empty());
    silent[50].people = MIN_PEAK_PEOPLE;
    assert_eq!(peaks(&silent, INTERVAL_US).len(), 1);
    // Exatamente 2,0× é pico; abaixo não.
    let mut exact = flat(5, 100);
    exact[50].people = 10;
    assert_eq!(peaks(&exact, INTERVAL_US)[0].ratio_tenths, 20);
    exact[50].people = 9;
    assert!(peaks(&exact, INTERVAL_US).is_empty());
    assert!(peaks(&[], INTERVAL_US).is_empty());
}

#[test]
fn the_label_appears_only_when_the_reaction_dominates() {
    let mut x = Interval {
        people: 10,
        messages: 10,
        laugh: 5,
        surprise: 2,
        ..Interval::default()
    };
    assert_eq!(x.dominant(), Some(Reaction::Laugh));
    x.laugh = 3; // 30 % das mensagens: não domina
    assert_eq!(x.dominant(), None);
    x.laugh = 2;
    x.surprise = 4;
    assert_eq!(x.dominant(), Some(Reaction::Surprise));
    // Poucas mensagens com a reação não dominam, mesmo sendo a maioria.
    let few = Interval {
        people: 2,
        messages: 2,
        clip: 2,
        ..Interval::default()
    };
    assert_eq!(few.dominant(), None);
    // Empate: risada antes de surpresa antes de clip.
    let tie = Interval {
        people: 10,
        messages: 10,
        laugh: 4,
        surprise: 4,
        clip: 4,
        ..Interval::default()
    };
    assert_eq!(tie.dominant(), Some(Reaction::Laugh));
}

#[test]
fn the_mark_has_the_energy_style_and_never_carries_text() {
    let m = |tenths, reaction| ChatMark {
        interval: 1,
        ratio_tenths: tenths,
        reaction,
        at_us: 0,
    };
    assert_eq!(mark(&m(31, Some(Reaction::Laugh))), "[chat 3,1× · risadas]");
    assert_eq!(mark(&m(20, None)), "[chat 2,0×]");
    assert_eq!(mark(&m(120, Some(Reaction::Clip))), "[chat 12,0× · pedido de clip]");
    assert_eq!(mark(&m(45, Some(Reaction::Surprise))), "[chat 4,5× · surpresa]");
}

#[test]
fn the_mark_points_back_by_the_reaction_delay() {
    // Pico no intervalo 6 (60 a 70 s): o momento é 50 a 60 s.
    let peak = Peak {
        interval: 6,
        people: 12,
        ratio_tenths: 40,
        reaction: None,
    };
    let frases = [
        sentence(1, 40, 50),
        sentence(2, 50, 55),
        sentence(3, 55, 60),
        sentence(4, 60, 70),
    ];
    let marks = marks_for_sentences(&[peak], INTERVAL_US, &frases);
    assert_eq!(marks.keys().copied().collect::<Vec<_>>(), [2, 3]);
    assert_eq!(marks[&2].at_us, 50_000_000);
    // A Frase que toca dois picos fica com o de maior razão.
    let stronger = Peak {
        interval: 7,
        ratio_tenths: 90,
        ..peak
    };
    let marks = marks_for_sentences(&[peak, stronger], INTERVAL_US, &[sentence(1, 55, 65)]);
    assert_eq!(marks[&1].ratio_tenths, 90);
}

#[test]
fn candidate_marks_list_one_entry_per_peak_in_the_span() {
    let frases = [sentence(1, 0, 10), sentence(2, 10, 20), sentence(3, 20, 30)];
    let peak = |interval, tenths| Peak {
        interval,
        people: 9,
        ratio_tenths: tenths,
        reaction: Some(Reaction::Laugh),
    };
    let marks = marks_for_sentences(&[peak(1, 31), peak(3, 25)], INTERVAL_US, &frases);
    let all = candidate_marks(&marks, &frases, 0, 2);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0]["ratio"], 3.1);
    assert_eq!(all[0]["reaction"], "laugh");
    assert!(candidate_marks(&marks, &frases, 2, 2).len() <= 1);
}
