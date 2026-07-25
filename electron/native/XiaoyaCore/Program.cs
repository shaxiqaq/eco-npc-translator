using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Forms;

namespace EcoToolbox.XiaoyaCore;

internal static class Program
{
    public const string Version = "0.2.0";
    public const string Mode = "native-background";

    [STAThread]
    private static int Main(string[] args)
    {
        int? parentPid = ParseParentPid(args);
        using var protocol = new JsonLineProtocol(Console.In, Console.Out);
        using var application = new CoreApplicationContext(protocol, parentPid);
        Application.Run(application);
        return 0;
    }

    private static int? ParseParentPid(string[] args)
    {
        for (int index = 0; index + 1 < args.Length; index++)
        {
            if (args[index] == "--parent-pid" &&
                int.TryParse(args[index + 1], out int pid) &&
                pid > 0)
            {
                return pid;
            }
        }
        return null;
    }
}

internal sealed class CoreApplicationContext : ApplicationContext
{
    private readonly JsonLineProtocol protocol;
    private readonly XiaoyaEngine engine;
    private readonly Control dispatcher;
    private readonly CancellationTokenSource lifetime = new();
    private readonly uint mainThreadId;
    private bool disposed;

    public CoreApplicationContext(JsonLineProtocol protocol, int? parentPid)
    {
        this.protocol = protocol;
        mainThreadId = NativeMethods.GetCurrentThreadId();
        engine = new XiaoyaEngine(protocol);
        dispatcher = new Control();
        _ = dispatcher.Handle;

        protocol.Emit(new
        {
            type = "hello",
            protocol = 1,
            version = Program.Version,
            architecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
            mode = Program.Mode
        });

        _ = Task.Run(() => ReadCommandsAsync(lifetime.Token));
        if (parentPid.HasValue)
            _ = Task.Run(() => MonitorParentAsync(parentPid.Value, lifetime.Token));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)
        {
            disposed = true;
            lifetime.Cancel();
            engine.Dispose();
            dispatcher.Dispose();
            lifetime.Dispose();
        }
        base.Dispose(disposing);
    }

    private async Task ReadCommandsAsync(CancellationToken cancellationToken)
    {
        try
        {
            await protocol.ReadCommandsAsync(HandleCommandAsync, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception error)
        {
            protocol.Emit(new { type = "fatal", error = error.Message });
        }
        finally
        {
            RequestExit();
        }
    }

    private Task HandleCommandAsync(ProtocolCommand command)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            dispatcher.BeginInvoke(new Action(() =>
            {
                try
                {
                    ProcessCommand(command);
                    completion.SetResult();
                }
                catch (Exception error)
                {
                    protocol.Respond(command.Id, false, new { error = error.Message });
                    completion.SetResult();
                }
            }));
        }
        catch (Exception error)
        {
            completion.SetException(error);
        }
        return completion.Task;
    }

    private void ProcessCommand(ProtocolCommand command)
    {
        switch (command.Command)
        {
            case "hello":
                protocol.Respond(command.Id, true, new
                {
                    protocol = 1,
                    version = Program.Version,
                    architecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
                    mode = Program.Mode
                });
                break;
            case "configure":
                engine.Configure(command.Payload);
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                break;
            case "start":
                engine.Start();
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                break;
            case "pause":
                engine.Pause();
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                break;
            case "stop":
                engine.Stop();
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                break;
            case "get-state":
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                break;
            case "toggle-ss":
                engine.ToggleSs();
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                break;
            case "toggle-visibility":
                bool visible = engine.ToggleVisibility();
                protocol.Respond(command.Id, true, new { visible, state = engine.Snapshot() });
                break;
            case "shutdown":
                engine.Stop();
                protocol.Respond(command.Id, true, new { state = engine.Snapshot() });
                RequestExit();
                break;
            default:
                protocol.Respond(command.Id, false, new { error = $"Unknown command: {command.Command}" });
                break;
        }
    }

    private async Task MonitorParentAsync(int parentPid, CancellationToken cancellationToken)
    {
        try
        {
            using Process parent = Process.GetProcessById(parentPid);
            while (!parent.HasExited)
                await Task.Delay(1000, cancellationToken);
        }
        catch (ArgumentException)
        {
        }
        catch (InvalidOperationException)
        {
        }
        catch (OperationCanceledException)
        {
            return;
        }
        RequestExit();
    }

    private void RequestExit()
    {
        NativeMethods.PostThreadMessage(mainThreadId, NativeMethods.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
    }
}

internal sealed class XiaoyaEngine : IDisposable
{
    private const int KeyHoldMilliseconds = 40;
    private const int SsKeyHoldMilliseconds = 100;
    private const int IdleSleepMilliseconds = 10;

    private readonly object sync = new();
    private readonly JsonLineProtocol protocol;
    private readonly long[] lastTriggered = new long[6];
    private SkillConfiguration[] skills = SkillConfiguration.Defaults();
    private CancellationTokenSource? workerCancellation;
    private Thread? workerThread;
    private int? targetPid;
    private IntPtr targetWindow;
    private string state = "stopped";
    private bool running;
    private long completedActions;

    public XiaoyaEngine(JsonLineProtocol protocol)
    {
        this.protocol = protocol;
    }

    public void Configure(JsonElement payload)
    {
        int? configuredPid = ReadTargetPid(payload);
        SkillConfiguration[] configuredSkills = payload.TryGetProperty("skills", out JsonElement skillsElement) &&
                                                skillsElement.ValueKind == JsonValueKind.Array
            ? SkillConfiguration.Parse(skillsElement)
            : SkillConfiguration.Defaults();

        lock (sync)
        {
            if (running && configuredPid != targetPid)
                throw new InvalidOperationException("请先停止小雅，再切换目标进程");

            if (configuredPid != targetPid)
                targetWindow = IntPtr.Zero;
            targetPid = configuredPid;
            skills = configuredSkills;
        }
        EmitState();
    }

    public void Start()
    {
        int pid;
        lock (sync)
        {
            if (running)
                return;
            pid = targetPid ?? throw new InvalidOperationException("请先选择要控制的 ECO 进程");
        }

        IntPtr window = NativeMethods.FindTargetWindow(pid);
        if (window == IntPtr.Zero)
            throw new InvalidOperationException($"找不到进程 {pid} 的可用主窗口");

        ToggleSsMode(window);

        var cancellation = new CancellationTokenSource();
        Thread thread;
        lock (sync)
        {
            long now = Stopwatch.GetTimestamp();
            for (int index = 0; index < lastTriggered.Length; index++)
                lastTriggered[index] = now - MillisecondsToTicks(skills[index].SkillTime * 1000L);

            targetWindow = window;
            workerCancellation = cancellation;
            state = "running";
            running = true;
            thread = new Thread(() => SchedulerLoop(cancellation.Token))
            {
                IsBackground = true,
                Name = "XiaoyaScheduler"
            };
            workerThread = thread;
        }

        thread.Start();
        protocol.Emit(new
        {
            type = "event",
            @event = "status",
            state = "running",
            message = $"后台技能循环已启动（目标进程 {pid}）"
        });
        EmitState();
    }

    public void Pause()
    {
        StopCore("paused", "后台技能循环已暂停");
    }

    public void Stop()
    {
        StopCore("stopped", "后台技能循环已停止");
    }

    public void ToggleSs()
    {
        (int pid, IntPtr window) = ResolveConfiguredTarget();
        ToggleSsMode(window);
        protocol.Emit(new
        {
            type = "event",
            @event = "ss-toggle",
            message = $"已向目标进程 {pid} 发送 SS 模式切换"
        });
    }

    public bool ToggleVisibility()
    {
        (int pid, IntPtr window) = ResolveConfiguredTarget();
        bool show = !NativeMethods.IsTargetWindowVisible(window);
        NativeMethods.SetTargetWindowVisible(window, show);
        protocol.Emit(new
        {
            type = "event",
            @event = "visibility",
            visible = show,
            message = show
                ? $"已显示目标进程 {pid} 的窗口"
                : $"已隐藏目标进程 {pid} 的窗口"
        });
        return show;
    }

    public object Snapshot()
    {
        lock (sync)
        {
            return new
            {
                state,
                running,
                monitoring = running,
                targetPid,
                targetWindow = targetWindow == IntPtr.Zero ? null : $"0x{targetWindow.ToInt64():X}",
                completedActions,
                mode = Program.Mode,
                skills
            };
        }
    }

    private static int? ReadTargetPid(JsonElement payload)
    {
        if (payload.TryGetProperty("targetPid", out JsonElement pidElement) &&
            pidElement.ValueKind == JsonValueKind.Number &&
            pidElement.TryGetInt32(out int parsedPid) &&
            parsedPid > 0)
        {
            return parsedPid;
        }
        return null;
    }

    private (int Pid, IntPtr Window) ResolveConfiguredTarget()
    {
        int pid;
        IntPtr cachedWindow;
        lock (sync)
        {
            pid = targetPid ?? throw new InvalidOperationException("请先选择要控制的 ECO 进程");
            cachedWindow = targetWindow;
        }

        IntPtr window = NativeMethods.IsWindowForProcess(cachedWindow, pid)
            ? cachedWindow
            : NativeMethods.FindTargetWindow(pid);
        if (window == IntPtr.Zero)
            throw new InvalidOperationException($"找不到进程 {pid} 的可用主窗口");

        lock (sync)
            targetWindow = window;
        return (pid, window);
    }

    private void SchedulerLoop(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                int pid;
                IntPtr window;
                lock (sync)
                {
                    pid = targetPid ?? 0;
                    window = targetWindow;
                }

                if (pid <= 0 || !NativeMethods.IsWindowForProcess(window, pid))
                {
                    MarkTargetLost(pid);
                    return;
                }

                bool performedAction = false;
                for (int index = 0; index < 6 && !cancellationToken.IsCancellationRequested; index++)
                {
                    SkillConfiguration skill;
                    long previousTrigger;
                    lock (sync)
                    {
                        skill = skills[index];
                        previousTrigger = lastTriggered[index];
                    }

                    if (!skill.Enabled)
                        continue;

                    long now = Stopwatch.GetTimestamp();
                    long intervalTicks = MillisecondsToTicks(skill.SkillTime * 1000L);
                    if (now - previousTrigger < intervalTicks)
                        continue;

                    lock (sync)
                        lastTriggered[index] = now;

                    PerformSkill(window, index, skill, cancellationToken);
                    lock (sync)
                        completedActions++;

                    performedAction = true;
                    protocol.Emit(new
                    {
                        type = "event",
                        @event = "action",
                        key = $"F{index + 1}",
                        mouse = skill.Mouse,
                        delay = skill.Delay,
                        timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    });

                    if (skill.Delay > 0 && WaitForCancellation(skill.Delay, cancellationToken))
                        return;
                }

                if (!performedAction && WaitForCancellation(IdleSleepMilliseconds, cancellationToken))
                    return;
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception error)
        {
            lock (sync)
            {
                running = false;
                state = "error";
            }
            protocol.Emit(new { type = "event", @event = "error", error = error.Message });
            EmitState();
        }
    }

    private static void PerformSkill(
        IntPtr window,
        int skillIndex,
        SkillConfiguration skill,
        CancellationToken cancellationToken)
    {
        uint virtualKey = NativeMethods.VK_F1 + checked((uint)skillIndex);
        PostKeyStroke(window, virtualKey, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();

        if (skill.Mouse)
            PostMouseClick(window, cancellationToken);
    }

    private static void PostKeyStroke(IntPtr window, uint virtualKey, CancellationToken cancellationToken)
    {
        uint scanCode = NativeMethods.MapVirtualKey(virtualKey, NativeMethods.MAPVK_VK_TO_VSC);
        IntPtr downParameter = MakeKeyParameter(scanCode, keyUp: false);
        IntPtr upParameter = MakeKeyParameter(scanCode, keyUp: true);

        NativeMethods.SendWindowMessage(window, NativeMethods.WM_KEYDOWN, (UIntPtr)virtualKey, downParameter);
        try
        {
            WaitForCancellation(KeyHoldMilliseconds, cancellationToken);
        }
        finally
        {
            NativeMethods.TrySendWindowMessage(window, NativeMethods.WM_KEYUP, (UIntPtr)virtualKey, upParameter);
        }
    }

    private static void PostMouseClick(IntPtr window, CancellationToken cancellationToken)
    {
        if (!NativeMethods.GetCursorPos(out NativeMethods.Point point))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "读取鼠标位置失败");
        if (!NativeMethods.ScreenToClient(window, ref point))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "换算目标窗口鼠标坐标失败");

        IntPtr coordinates = MakeMouseParameter(point.X, point.Y);
        NativeMethods.SendWindowMessage(
            window,
            NativeMethods.WM_MOUSEMOVE,
            (UIntPtr)NativeMethods.MK_RBUTTON,
            coordinates);
        NativeMethods.SendWindowMessage(
            window,
            NativeMethods.WM_LBUTTONDOWN,
            (UIntPtr)NativeMethods.MK_LBUTTON,
            coordinates);
        try
        {
            WaitForCancellation(KeyHoldMilliseconds, cancellationToken);
        }
        finally
        {
            NativeMethods.TrySendWindowMessage(
                window,
                NativeMethods.WM_MOUSEMOVE,
                (UIntPtr)NativeMethods.MK_RBUTTON,
                coordinates);
            NativeMethods.TrySendWindowMessage(
                window,
                NativeMethods.WM_LBUTTONUP,
                UIntPtr.Zero,
                coordinates);
        }
    }

    private static void ToggleSsMode(IntPtr window)
    {
        uint controlScanCode = NativeMethods.MapVirtualKey(NativeMethods.VK_CONTROL, NativeMethods.MAPVK_VK_TO_VSC);
        uint tScanCode = NativeMethods.MapVirtualKey(NativeMethods.VK_T, NativeMethods.MAPVK_VK_TO_VSC);
        uint currentThread = NativeMethods.GetCurrentThreadId();
        uint targetThread = NativeMethods.GetTargetWindowThread(window);
        if (targetThread == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法读取目标窗口线程");
        bool attached = targetThread != 0 &&
                        targetThread != currentThread &&
                        NativeMethods.AttachThreadInput(currentThread, targetThread, true);
        if (targetThread != currentThread && !attached)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法连接目标窗口输入线程");
        byte[] originalKeyboardState = new byte[256];
        bool keyboardStateCaptured = NativeMethods.GetKeyboardState(originalKeyboardState);
        if (!keyboardStateCaptured)
        {
            if (attached)
                NativeMethods.AttachThreadInput(currentThread, targetThread, false);
            throw new Win32Exception(Marshal.GetLastWin32Error(), "读取目标窗口键盘状态失败");
        }

        try
        {
            NativeMethods.keybd_event(
                (byte)NativeMethods.VK_CONTROL,
                (byte)controlScanCode,
                0,
                UIntPtr.Zero);
            byte[] controlKeyboardState = (byte[])originalKeyboardState.Clone();
            controlKeyboardState[(int)NativeMethods.VK_CONTROL] |= 0x80;
            if (!NativeMethods.SetKeyboardState(controlKeyboardState))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "设置目标窗口 Ctrl 状态失败");

            NativeMethods.PostWindowMessage(
                window,
                NativeMethods.WM_KEYDOWN,
                (UIntPtr)NativeMethods.VK_T,
                MakeKeyParameter(tScanCode, keyUp: false));
            Thread.Sleep(SsKeyHoldMilliseconds);
            NativeMethods.TryPostWindowMessage(
                window,
                NativeMethods.WM_KEYUP,
                (UIntPtr)NativeMethods.VK_T,
                MakeKeyParameter(tScanCode, keyUp: true));
        }
        finally
        {
            NativeMethods.keybd_event(
                (byte)NativeMethods.VK_CONTROL,
                (byte)controlScanCode,
                NativeMethods.KEYEVENTF_KEYUP,
                UIntPtr.Zero);
            if (keyboardStateCaptured)
                NativeMethods.SetKeyboardState(originalKeyboardState);
            if (attached)
                NativeMethods.AttachThreadInput(currentThread, targetThread, false);
        }
    }

    private void StopCore(string finalState, string message)
    {
        Thread? thread;
        CancellationTokenSource? cancellation;
        IntPtr window;
        int pid;
        bool shouldToggleSs;

        lock (sync)
        {
            thread = workerThread;
            cancellation = workerCancellation;
            window = targetWindow;
            pid = targetPid ?? 0;
            shouldToggleSs = running;
            running = false;
            if (thread is not null)
                state = "stopping";
        }

        cancellation?.Cancel();
        if (thread is not null && thread != Thread.CurrentThread)
            thread.Join(2000);

        if (shouldToggleSs && NativeMethods.IsWindowForProcess(window, pid))
        {
            try
            {
                ToggleSsMode(window);
            }
            catch (Exception error)
            {
                protocol.Emit(new
                {
                    type = "event",
                    @event = "warning",
                    message = $"技能循环已停止，但 SS 模式切换失败：{error.Message}"
                });
            }
        }

        lock (sync)
        {
            if (workerThread == thread)
            {
                workerThread = null;
                workerCancellation = null;
            }
            targetWindow = IntPtr.Zero;
            state = finalState;
        }
        cancellation?.Dispose();

        protocol.Emit(new { type = "event", @event = "status", state = finalState, message });
        EmitState();
    }

    private void MarkTargetLost(int pid)
    {
        lock (sync)
        {
            running = false;
            state = "target-lost";
            targetWindow = IntPtr.Zero;
        }
        protocol.Emit(new
        {
            type = "event",
            @event = "target-lost",
            message = $"目标进程 {pid} 的窗口已关闭，技能循环已停止"
        });
        EmitState();
    }

    private static bool WaitForCancellation(int milliseconds, CancellationToken cancellationToken)
    {
        return milliseconds > 0 && cancellationToken.WaitHandle.WaitOne(milliseconds);
    }

    private static long MillisecondsToTicks(long milliseconds)
    {
        return checked(milliseconds * Stopwatch.Frequency / 1000L);
    }

    private static IntPtr MakeKeyParameter(uint scanCode, bool keyUp)
    {
        uint value = 1u | ((scanCode & 0xFFu) << 16);
        if (keyUp)
            value |= 0xC0000000u;
        return new IntPtr(unchecked((int)value));
    }

    private static IntPtr MakeMouseParameter(int x, int y)
    {
        uint value = (uint)(ushort)x | ((uint)(ushort)y << 16);
        return new IntPtr(unchecked((int)value));
    }

    private void EmitState()
    {
        protocol.Emit(new { type = "event", @event = "state", state = Snapshot() });
    }

    public void Dispose()
    {
        Stop();
    }
}

internal sealed class SkillConfiguration
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; }

    [JsonPropertyName("skillTime")]
    public int SkillTime { get; init; }

    [JsonPropertyName("mouse")]
    public bool Mouse { get; init; }

    [JsonPropertyName("delay")]
    public int Delay { get; init; }

    public static SkillConfiguration[] Defaults() =>
    [
        new() { Enabled = true, SkillTime = 8, Mouse = true, Delay = 2500 },
        new() { Enabled = true, SkillTime = 15, Mouse = true, Delay = 2300 },
        new() { Enabled = true, SkillTime = 15, Mouse = true, Delay = 2300 },
        new() { Enabled = true, SkillTime = 50, Mouse = true, Delay = 3000 },
        new() { Enabled = false, SkillTime = 15, Mouse = true, Delay = 3000 },
        new() { Enabled = false, SkillTime = 15, Mouse = true, Delay = 3000 }
    ];

    public static SkillConfiguration[] Parse(JsonElement array)
    {
        SkillConfiguration[] defaults = Defaults();
        int index = 0;
        foreach (JsonElement item in array.EnumerateArray())
        {
            if (index >= defaults.Length)
                break;
            SkillConfiguration fallback = defaults[index];
            defaults[index] = new SkillConfiguration
            {
                Enabled = ReadBoolean(item, "enabled", fallback.Enabled),
                SkillTime = ReadInteger(item, "skillTime", fallback.SkillTime, 0, 86400),
                Mouse = ReadBoolean(item, "mouse", fallback.Mouse),
                Delay = ReadInteger(item, "delay", fallback.Delay, 0, 60000)
            };
            index++;
        }
        return defaults;
    }

    private static bool ReadBoolean(JsonElement item, string property, bool fallback)
    {
        if (!item.TryGetProperty(property, out JsonElement value))
            return fallback;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => fallback
        };
    }

    private static int ReadInteger(JsonElement item, string property, int fallback, int minimum, int maximum)
    {
        if (!item.TryGetProperty(property, out JsonElement value) || !value.TryGetInt32(out int parsed))
            return fallback;
        return Math.Clamp(parsed, minimum, maximum);
    }
}

internal sealed class JsonLineProtocol : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly TextReader input;
    private readonly TextWriter output;
    private readonly object outputSync = new();

    public JsonLineProtocol(TextReader input, TextWriter output)
    {
        this.input = input;
        this.output = output;
    }

    public async Task ReadCommandsAsync(
        Func<ProtocolCommand, Task> handler,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            string? line = await input.ReadLineAsync(cancellationToken);
            if (line is null)
                break;
            if (string.IsNullOrWhiteSpace(line))
                continue;

            ProtocolCommand? command;
            try
            {
                command = JsonSerializer.Deserialize<ProtocolCommand>(line, JsonOptions);
            }
            catch (JsonException error)
            {
                Emit(new { type = "protocol-error", error = error.Message });
                continue;
            }

            if (command is null || string.IsNullOrWhiteSpace(command.Command))
            {
                Emit(new { type = "protocol-error", error = "Command is missing" });
                continue;
            }
            await handler(command);
        }
    }

    public void Respond(long id, bool ok, object payload)
    {
        Emit(new { id, type = "response", ok, payload });
    }

    public void Emit(object message)
    {
        string json = JsonSerializer.Serialize(message, JsonOptions);
        lock (outputSync)
        {
            output.WriteLine(json);
            output.Flush();
        }
    }

    public void Dispose()
    {
        output.Flush();
    }
}

internal sealed class ProtocolCommand
{
    [JsonPropertyName("id")]
    public long Id { get; init; }

    [JsonPropertyName("command")]
    public string Command { get; init; } = string.Empty;

    [JsonPropertyName("payload")]
    public JsonElement Payload { get; init; }
}

internal static class NativeMethods
{
    public const uint WM_QUIT = 0x0012;
    public const uint WM_KEYDOWN = 0x0100;
    public const uint WM_KEYUP = 0x0101;
    public const uint WM_MOUSEMOVE = 0x0200;
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP = 0x0202;
    public const uint VK_CONTROL = 0x11;
    public const uint VK_T = 0x54;
    public const uint VK_F1 = 0x70;
    public const uint MK_LBUTTON = 0x0001;
    public const uint MK_RBUTTON = 0x0002;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint MAPVK_VK_TO_VSC = 0;
    private const uint SMTO_ABORTIFHUNG = 0x0002;
    private const uint MessageTimeoutMilliseconds = 1000;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }

    public static IntPtr FindTargetWindow(int processId)
    {
        try
        {
            using Process process = Process.GetProcessById(processId);
            process.Refresh();
            IntPtr mainWindow = process.MainWindowHandle;
            if (IsWindowForProcess(mainWindow, processId))
                return mainWindow;
        }
        catch (ArgumentException)
        {
            return IntPtr.Zero;
        }
        catch (InvalidOperationException)
        {
            return IntPtr.Zero;
        }

        IntPtr found = IntPtr.Zero;
        EnumWindows((window, _) =>
        {
            if (GetWindowTextLength(window) <= 0)
                return true;
            GetWindowThreadProcessId(window, out uint windowPid);
            if (windowPid != (uint)processId)
                return true;
            found = window;
            return !IsWindowVisibleNative(window);
        }, IntPtr.Zero);
        return found;
    }

    public static bool IsWindowForProcess(IntPtr window, int processId)
    {
        if (window == IntPtr.Zero || processId <= 0 || !IsWindow(window))
            return false;
        GetWindowThreadProcessId(window, out uint windowPid);
        return windowPid == (uint)processId;
    }

    public static uint GetTargetWindowThread(IntPtr window)
    {
        return window == IntPtr.Zero ? 0 : GetWindowThreadProcessId(window, out _);
    }

    public static bool IsTargetWindowVisible(IntPtr window)
    {
        return window != IntPtr.Zero && IsWindowVisibleNative(window);
    }

    public static void SetTargetWindowVisible(IntPtr window, bool visible)
    {
        ShowWindowAsync(window, visible ? SW_SHOW : SW_HIDE);
    }

    public static void PostWindowMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam)
    {
        if (!PostMessage(window, message, wParam, lParam))
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"发送窗口消息 0x{message:X4} 失败");
    }

    public static bool TryPostWindowMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam)
    {
        return window != IntPtr.Zero && PostMessage(window, message, wParam, lParam);
    }

    public static void SendWindowMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam)
    {
        if (SendMessageTimeout(
                window,
                message,
                wParam,
                lParam,
                SMTO_ABORTIFHUNG,
                MessageTimeoutMilliseconds,
                out _) == IntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                $"同步发送窗口消息 0x{message:X4} 失败或超时");
        }
    }

    public static bool TrySendWindowMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam)
    {
        return window != IntPtr.Zero &&
               SendMessageTimeout(
                   window,
                   message,
                   wParam,
                   lParam,
                   SMTO_ABORTIFHUNG,
                   MessageTimeoutMilliseconds,
                   out _) != IntPtr.Zero;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll", EntryPoint = "IsWindowVisible")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisibleNative(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr window);

    private const int SW_HIDE = 0;
    private const int SW_SHOW = 5;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr window,
        uint message,
        UIntPtr wParam,
        IntPtr lParam,
        uint flags,
        uint timeout,
        out UIntPtr result);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint code, uint mapType);

    [DllImport("user32.dll")]
    public static extern void keybd_event(
        byte virtualKey,
        byte scanCode,
        uint flags,
        UIntPtr extraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(
        uint threadIdAttach,
        uint threadIdAttachTo,
        [MarshalAs(UnmanagedType.Bool)] bool attach);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetKeyboardState([Out] byte[] keyboardState);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetKeyboardState([In] byte[] keyboardState);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ScreenToClient(IntPtr window, ref Point point);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostThreadMessage(
        uint threadId,
        uint message,
        UIntPtr wParam,
        IntPtr lParam);
}
