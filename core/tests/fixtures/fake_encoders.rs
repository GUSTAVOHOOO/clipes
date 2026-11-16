//! FFmpeg/ffprobe falsos para a detecção de encoder (#62): lista de encoders e falhas simuladas
//! por variável de ambiente, sem rede. O mesmo executável vira `ffprobe` pelo nome do arquivo.
//! `CLIPES_FAKE_ENCODERS` lista os encoders presentes, `CLIPES_FAKE_FAIL` os que saem com erro,
//! `CLIPES_FAKE_BAD_OUTPUT` os que geram um arquivo que não é H.264 e `CLIPES_FAKE_LOG` recebe
//! uma linha por export com o encoder pedido.
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

fn listed(name: &str) -> bool {
    env::var("CLIPES_FAKE_ENCODERS")
        .unwrap_or_default()
        .split(',')
        .any(|n| n == name)
}
fn flagged(var: &str, name: &str) -> bool {
    env::var(var)
        .unwrap_or_default()
        .split(',')
        .any(|n| n == name)
}
fn main() {
    let args: Vec<String> = env::args().collect();
    let probe = Path::new(&args[0]).file_stem().unwrap() == "ffprobe";
    if args.iter().any(|a| a == "-version") {
        if probe {
            println!("ffprobe version fixture");
        } else {
            println!(
                "ffmpeg version {} Copyright fixture",
                env::var("CLIPES_FAKE_VERSION").unwrap_or_else(|_| "fixture".into())
            );
        }
        return;
    }
    let last = args.last().unwrap();
    if probe {
        let text = fs::read_to_string(last).unwrap_or_default();
        let name = text.strip_prefix("h264:").unwrap_or("");
        let codec = if flagged("CLIPES_FAKE_BAD_OUTPUT", name) {
            "mpeg4"
        } else {
            "h264"
        };
        println!("{codec},1080,1920");
        return;
    }
    if args.iter().any(|a| a == "-encoders") {
        for name in [
            "libx264",
            "h264_nvenc",
            "h264_qsv",
            "h264_amf",
            "h264_videotoolbox",
        ] {
            if name == "libx264" || listed(name) {
                println!(" V....D {name:<18} fixture");
            }
        }
        println!(" A....D aac                 fixture");
        return;
    }
    if args.iter().any(|a| a == "filter=ass") {
        println!("Filter ass\nfontsdir filename");
        return;
    }
    let encoder = args
        .iter()
        .position(|a| a == "-c:v")
        .map(|i| args[i + 1].clone())
        .unwrap_or_default();
    if let Some(log) = env::var_os("CLIPES_FAKE_LOG") {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .unwrap();
        writeln!(file, "{encoder}").unwrap();
    }
    if flagged("CLIPES_FAKE_FAIL", &encoder) {
        eprintln!("fixture: encoder indisponível em /home/segredo");
        std::process::exit(1);
    }
    fs::write(last, format!("h264:{encoder}")).unwrap();
    println!("out_time_us=100000");
    eprintln!("Loading font file 'fonts/NotoSans-Bold.ttf'");
    eprintln!("fontselect: (Noto Sans, 700, 0) -> NotoSans-Bold, 0, NotoSans-Bold");
}
