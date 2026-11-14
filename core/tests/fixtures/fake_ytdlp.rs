use std::{env, fs, io::{self, Write}, thread, time::Duration};
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("--child") {
        thread::sleep(Duration::from_secs(2)); fs::write(&args[2], b"survived").unwrap(); return;
    }
    if args.get(1).map(String::as_str) == Some("--version") {
        if std::path::Path::new(&args[0]).with_file_name("version-hang").exists() { thread::sleep(Duration::from_secs(30)); }
        println!("2027.01.01.000000"); return;
    }

    if args.get(1).map(String::as_str) == Some("-v") {
        println!(r#"{{"format":{{"duration":"1.0"}},"streams":[{{"index":0,"codec_type":"audio"}}]}}"#);
        return;
    }

    assert!(!args.iter().any(|a| a == "--no-color"));
    assert!(args.windows(2).any(|w| w == ["--match-filters", "live_status !=? is_live & live_status !=? is_upcoming & live_status !=? post_live"]));

    assert!(args.windows(2).any(|w| w == ["--color", "never"]));
    assert!(args.iter().any(|a| a == "--no-simulate"));
    let i = args.iter().position(|a| a == "-o").unwrap();
    let end = args.iter().position(|a| a == "--").unwrap();
    let url = &args[end + 1];
    let target = args[i + 1].replace("%(id)s", "video123").replace("%(ext)s", "mp4");
    fs::write(&target, b"media").unwrap();
    if url.ends_with("hang-child") {
        let marker = std::path::Path::new(&target).parent().unwrap().parent().unwrap().join("child-survived");
        std::process::Command::new(&args[0]).arg("--child").arg(marker).spawn().unwrap();
    }

    println!("clipes-progress: 42.0%"); io::stdout().flush().unwrap();
    if url.ends_with("hang") || url.ends_with("hang-child") { thread::sleep(Duration::from_secs(30)); }
    if url.ends_with("fail") { eprintln!("secret path must not escape"); std::process::exit(1); }
    println!("clipes-file:{target}");
}
