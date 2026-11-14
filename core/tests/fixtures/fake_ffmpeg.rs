use std::{env, fs, io::{self, Write}, path::PathBuf, thread, time::Duration};
fn main() {
    let args: Vec<String> = env::args().collect();
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
