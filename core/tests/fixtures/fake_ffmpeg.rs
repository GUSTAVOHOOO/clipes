use std::{env, fs, io::{self, Write}, path::PathBuf, thread, time::Duration};
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "-show_format") {
        let duration = env::var("CLIPES_FAKE_DURATION").unwrap_or("1".into());
        println!("{{\"format\":{{\"duration\":\"{duration}\"}},\"streams\":[{{\"index\":0,\"codec_type\":\"audio\"}},{{\"index\":1,\"codec_type\":\"audio\"}}]}}");
        return;
    }
    if let Some(pos) = args.iter().position(|a| a == "-t") {
        // Extração de áudio da Transcrição: o "áudio" falso guarda só a duração do bloco.
        fs::write(args.last().unwrap(), &args[pos + 1]).unwrap();
        if let Some(state) = env::var_os("CLIPES_FAKE_FFMPEG_STATE") {
            let mut log = fs::OpenOptions::new().create(true).append(true).open(PathBuf::from(state).join("extract-args.log")).unwrap();
            writeln!(log, "{}", args[1..].join(" ")).unwrap();
        }
        return;
    }
    let state = PathBuf::from(env::var_os("CLIPES_FAKE_FFMPEG_STATE").unwrap());
    if args.iter().any(|x| x == "pipe:1") {
        fs::write(state.join("running"), b"running").unwrap();
        while !state.join("continue").exists() { thread::sleep(Duration::from_millis(20)); }
        io::stdout().write_all(&vec![0u8; 16000]).unwrap();
    } else {
        let output = args.last().unwrap().replace("%08d", "00000001");
        fs::write(output, b"fixture").unwrap();
    }
}
