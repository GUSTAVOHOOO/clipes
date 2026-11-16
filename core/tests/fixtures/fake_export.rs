//! FFmpeg falso só para exercitar falha/cancelamento do export, sem rede.
use std::{
    env, fs,
    io::{self, Write},
    path::Path,
    thread,
    time::Duration,
};
fn main() {
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
    if args.iter().any(|a| a == "filter=ass") {
        if env::var_os("CLIPES_FAKE_NO_ASS").is_none() {
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
    if let Some(dir) = env::var_os("CLIPES_FAKE_EXPORT_STATE") {
        fs::write(Path::new(&dir).join("started"), b"ready").unwrap();
        while !Path::new(&dir).join("continue").exists() {
            thread::sleep(Duration::from_millis(10));
        }
    }
    if env::var_os("CLIPES_FAKE_EXPORT_FAIL").is_some() {
        std::process::exit(1);
    }
    eprintln!("Loading font file 'fonts/NotoSans-Bold.ttf'");
    eprintln!("fontselect: (Noto Sans, 700, 0) -> NotoSans-Bold, 0, NotoSans-Bold");
}
