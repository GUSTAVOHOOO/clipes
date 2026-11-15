// FFmpeg/ffprobe falso da energia do áudio (#54): `pipe:1` devolve o PCM s16le gravado em
// CLIPES_FAKE_PCM; o resto imita o mínimo que a importação e a prévia pedem.
use std::{env, fs, io::{self, Write}};
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "-show_format") {
        let duration = env::var("CLIPES_FAKE_DURATION").unwrap_or("1".into());
        println!("{{\"format\":{{\"duration\":\"{duration}\"}},\"streams\":[{{\"index\":0,\"codec_type\":\"audio\",\"channels\":1}}]}}");
        return;
    }
    if args.iter().any(|x| x == "pipe:1") {
        if let Some(path) = env::var_os("CLIPES_FAKE_PCM") {
            io::stdout().write_all(&fs::read(path).unwrap()).unwrap();
        }
        return;
    }
    let output = args.last().unwrap().replace("%08d", "00000001");
    fs::write(output, b"fixture").unwrap();
}
