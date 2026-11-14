use std::ffi::OsStr;
use std::io;
use std::process::{Child, Command};

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
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
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
