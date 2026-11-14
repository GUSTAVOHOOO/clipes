// A CLI that never finishes: it and a grandchild rewrite a counter file until killed.
use std::{env, fs, process::Command, thread, time::Duration};
fn beat(var: &str) -> ! {
    let path = env::var(var).unwrap();
    let mut n: u64 = 0;
    loop {
        n += 1;
        let _ = fs::write(&path, n.to_string());
        thread::sleep(Duration::from_millis(50));
    }
}
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args == ["--help"] {
        println!("--tools <tools...>");
        return;
    }
    if args == ["grandchild"] {
        beat("FAKE_BEAT_CHILD");
    }
    Command::new(env::current_exe().unwrap())
        .arg("grandchild")
        .spawn()
        .unwrap();
    beat("FAKE_BEAT");
}
