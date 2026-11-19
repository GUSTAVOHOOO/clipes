use std::ffi::OsStr;
use std::io;
use std::process::{Child, Command};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

#[cfg(windows)]
trait CreationFlagsTarget {
    fn set_creation_flags(&mut self, flags: u32);
}

#[cfg(windows)]
impl CreationFlagsTarget for Command {
    fn set_creation_flags(&mut self, flags: u32) {
        use std::os::windows::process::CommandExt;
        self.creation_flags(flags);
    }
}

#[cfg(windows)]
fn apply_no_window_flags(target: &mut impl CreationFlagsTarget, existing_flags: u32) {
    target.set_creation_flags(existing_flags | CREATE_NO_WINDOW);
}

/// Ensures console child processes do not open a console window on Windows.
/// No-op on non-Windows targets.
pub fn sem_janela(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        apply_no_window_flags(command, 0);
    }
    command
}

/// Starts an executable directly, without passing arguments through a shell.
pub fn spawn<I, S>(
    program: impl AsRef<OsStr>,
    arguments: I,
    directory: Option<&std::path::Path>,
) -> io::Result<Child>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(directory) = directory {
        command
            .current_dir(directory)
            .stdin(std::process::Stdio::piped());
    }
    sem_janela(&mut command);
    command.spawn()
}

/// A subprocess group that can be terminated together with its descendants.
pub struct ProcessGroup {
    #[cfg(unix)]
    id: i32,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

pub fn spawn_managed<I, S>(
    program: impl AsRef<OsStr>,
    arguments: I,
) -> io::Result<(Child, ProcessGroup)>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    spawn_managed_with(program, arguments, |_| {})
}

/// Like [`spawn_managed`], letting the caller adjust the command (environment,
/// piped stdin, working directory) before it starts. Still no shell.
pub fn spawn_managed_with<I, S>(
    program: impl AsRef<OsStr>,
    arguments: I,
    configure: impl FnOnce(&mut Command),
) -> io::Result<(Child, ProcessGroup)>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    configure(&mut command);
    sem_janela(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        // A crashed parent must not leave an FFmpeg process writing into a cache
        // that a restarted queue is about to reconcile.
        #[cfg(target_os = "linux")]
        {
            let parent = unsafe { libc::getpid() };
            unsafe {
                command.pre_exec(move || {
                    if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    if libc::getppid() != parent {
                        return Err(io::Error::other("parent process exited"));
                    }
                    Ok(())
                });
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        };
        // The handle is owned by ProcessGroup and closed on every failure or drop.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                let error = io::Error::last_os_error();
                CloseHandle(job);
                return Err(error);
            }
            let mut child = match command.spawn() {
                Ok(child) => child,
                Err(error) => {
                    CloseHandle(job);
                    return Err(error);
                }
            };
            if AssignProcessToJobObject(job, child.as_raw_handle().cast()) == 0 {
                let error = io::Error::last_os_error();
                let _ = child.kill();
                let _ = child.wait();
                CloseHandle(job);
                return Err(error);
            }
            Ok((child, ProcessGroup { job }))
        }
    }
    #[cfg(unix)]
    {
        let child = command.spawn()?;
        let id = child.id() as i32;
        Ok((child, ProcessGroup { id }))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let child = command.spawn()?;
        Ok((child, ProcessGroup {}))
    }
}
impl ProcessGroup {
    pub fn terminate(&self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.id, libc::SIGKILL);
        }
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
        }
    }
}
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeFlagsTarget {
        flags: Option<u32>,
    }

    impl CreationFlagsTarget for FakeFlagsTarget {
        fn set_creation_flags(&mut self, flags: u32) {
            self.flags = Some(flags);
        }
    }

    #[test]
    fn apply_no_window_flags_sets_and_preserves_existing_flags() {
        let mut target = FakeFlagsTarget::default();
        apply_no_window_flags(&mut target, 0);
        assert_eq!(target.flags, Some(CREATE_NO_WINDOW));

        let existing = 0x0000_0200; // CREATE_NEW_PROCESS_GROUP
        apply_no_window_flags(&mut target, existing);
        assert_eq!(target.flags, Some(existing | CREATE_NO_WINDOW));
    }

    #[test]
    fn spawn_and_spawn_managed_succeed_with_no_window_flag() {
        let exe = std::env::current_exe().unwrap();

        let output = spawn(&exe, ["--help"], None)
            .unwrap()
            .wait_with_output()
            .unwrap();
        assert!(output.status.success());

        let (child, _group) = spawn_managed(&exe, ["--help"]).unwrap();
        let managed_output = child.wait_with_output().unwrap();
        assert!(managed_output.status.success());
    }
}
