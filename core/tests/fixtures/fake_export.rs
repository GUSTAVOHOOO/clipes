//! FFmpeg falso só para exercitar falha/cancelamento do export, sem rede.
use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

#[derive(Default)]
struct Config {
    no_ass: bool,
    export_fail: bool,
    export_state: Option<PathBuf>,
}

impl Config {
    /// Lê configuração isolada ao lado do executável quando presente; senão usa variáveis de ambiente.
    fn load() -> Self {
        if let Some(path) = env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("fake-export.conf")))
            .filter(|path| path.is_file())
        {
            let mut config = Self::default();
            if let Ok(text) = fs::read_to_string(&path) {
                for line in text.lines() {
                    let Some((key, value)) = line.trim().split_once('=') else {
                        continue;
                    };
                    let value = value.trim();
                    match key.trim() {
                        "NO_ASS" => config.no_ass = !value.is_empty() && value != "0",
                        "EXPORT_FAIL" => config.export_fail = !value.is_empty() && value != "0",
                        "EXPORT_STATE" => {
                            config.export_state = (!value.is_empty()).then(|| PathBuf::from(value));
                        }
                        _ => {}
                    }
                }
            }
            return config;
        }
        Self {
            no_ass: env::var_os("CLIPES_FAKE_NO_ASS").is_some(),
            export_fail: env::var_os("CLIPES_FAKE_EXPORT_FAIL").is_some(),
            export_state: env::var_os("CLIPES_FAKE_EXPORT_STATE").map(PathBuf::from),
        }
    }
}

fn main() {
    let config = Config::load();
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|a| a == "-version") {
        println!(
            "{} version fixture",
            if Path::new(&args[0]).file_stem().unwrap() == "ffprobe" {
                "ffprobe"
            } else {
                "ffmpeg"
            }
        );
        return;
    }
    if args.iter().any(|a| a == "-encoders") {
        return;
    }
    if args.iter().any(|a| a.starts_with("testsrc2")) {
        let output = args.last().unwrap();
        fs::write(output, b"probe mp4").unwrap();
        return;
    }
    if args.iter().any(|a| a == "filter=ass") {
        if !config.no_ass {
            println!("Filter ass\nfontsdir filename");
        } else {
            println!("Unknown filter 'ass'.");
        }
        return;
    }
    // Primeira passagem do loudnorm (#63): só imprime a medição no stderr, sem saída.
    if args.iter().any(|a| a == "-vn") {
        eprintln!("[Parsed_loudnorm_0 @ 0x0] \n{{\n\t\"input_i\" : \"-27.61\",\n\t\"input_tp\" : \"-4.47\",\n\t\"input_lra\" : \"18.06\",\n\t\"input_thresh\" : \"-39.20\",\n\t\"output_i\" : \"-16.58\",\n\t\"normalization_type\" : \"dynamic\",\n\t\"target_offset\" : \"0.58\"\n}}");
        return;
    }
    let output = args.last().unwrap();
    fs::write(output, b"partial mp4").unwrap();
    println!("out_time_us=100000");
    io::stdout().flush().unwrap();
    if let Some(dir) = &config.export_state {
        fs::write(dir.join("started"), b"ready").unwrap();
        while !dir.join("continue").exists() {
            thread::sleep(Duration::from_millis(10));
        }
    }
    if config.export_fail {
        std::process::exit(1);
    }
    eprintln!("Loading font file 'fonts/NotoSans-Bold.ttf'");
    eprintln!("fontselect: (Noto Sans, 700, 0) -> NotoSans-Bold, 0, NotoSans-Bold");
}
