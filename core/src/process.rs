use std::ffi::OsStr;
use std::io;
use std::process::{Child, Command};

/// Starts an executable directly, without passing arguments through a shell.
pub fn spawn<I, S>(program: impl AsRef<OsStr>, arguments: I) -> io::Result<Child>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    Command::new(program).args(arguments).spawn()
}
