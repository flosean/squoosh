using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const int Port = 5000;
    private static TcpListener listener;
    private static string webRoot;
    private static bool openBrowser;

    [STAThread]
    private static void Main(string[] args)
    {
        openBrowser = Array.IndexOf(args, "--no-browser") < 0;

        try
        {
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start();
            webRoot = ExtractApp();
            OpenBrowser();
            if (!openBrowser) { ServeLoop(); return; }
            var serverThread = new Thread(ServeLoop) { IsBackground = true };
            serverThread.Start();
            using (var menu = new ContextMenuStrip())
            using (var tray = new NotifyIcon())
            {
                menu.Items.Add("開啟 Squoosh", null, (sender, e) => OpenBrowser());
                menu.Items.Add("結束 Squoosh", null, (sender, e) => Application.Exit());
                tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                tray.Text = "Squoosh 批次圖片壓縮";
                tray.ContextMenuStrip = menu;
                tray.DoubleClick += (sender, e) => OpenBrowser();
                tray.Visible = true;
                Application.Run();
                tray.Visible = false;
            }
        }
        catch (SocketException error)
        {
            if (error.SocketErrorCode == SocketError.AddressAlreadyInUse)
            {
                if (IsCurrentServer()) OpenBrowser();
                else ShowError("連接埠 5000 已被其他程式或舊版 Squoosh 使用。請先關閉該程式，再開啟此版本。");
                return;
            }
            ShowError(error.Message);
        }
        catch (Exception error)
        {
            ShowError(error.Message);
        }
        finally { if (listener != null) listener.Stop(); }
    }

    private static void ServeLoop()
    {
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch (SocketException) { break; }
            catch (ObjectDisposedException) { break; }
            ThreadPool.QueueUserWorkItem(_ => Serve(client));
        }
    }

    private static string ServerVersion()
    {
        return "SquooshBatch:" + Assembly.GetExecutingAssembly().ManifestModule.ModuleVersionId.ToString("N");
    }

    private static bool IsCurrentServer()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/_squoosh/version");
            request.Proxy = null;
            request.Timeout = 3000;
            request.ReadWriteTimeout = 3000;
            request.AllowAutoRedirect = false;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadLine() == ServerVersion();
        }
        catch { return false; }
    }

    private static string ExtractApp()
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        string version = assembly.ManifestModule.ModuleVersionId.ToString("N");
        string appDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SquooshBatch",
            version
        );
        string root = Path.Combine(appDirectory, "build");

        Directory.CreateDirectory(appDirectory);
        using (Stream resource = assembly.GetManifestResourceStream("SquooshApp"))
        {
            if (resource == null) throw new InvalidOperationException("找不到內嵌的應用程式資源。");
            using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string destination = Path.GetFullPath(
                        Path.Combine(appDirectory, entry.FullName.Replace('/', Path.DirectorySeparatorChar))
                    );
                    if (!destination.StartsWith(appDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("應用程式資源包含無效路徑。");

                    if (String.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    if (File.Exists(destination) && new FileInfo(destination).Length == entry.Length)
                    {
                        using (var hash = SHA256.Create())
                        using (var disk = File.OpenRead(destination))
                        using (var embedded = entry.Open())
                            if (Convert.ToBase64String(hash.ComputeHash(disk)) == Convert.ToBase64String(hash.ComputeHash(embedded))) continue;
                    }
                    string temporary = destination + ".tmp-" + Guid.NewGuid().ToString("N");
                    try
                    {
                        entry.ExtractToFile(temporary, false);
                        if (File.Exists(destination)) File.Delete(destination);
                        File.Move(temporary, destination);
                    }
                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                }
            }
        }

        return root;
    }

    private static void Serve(TcpClient client)
    {
        client.ReceiveTimeout = 5000;
        client.SendTimeout = 10000;
        using (client)
        using (NetworkStream stream = client.GetStream())
        using (StreamReader reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true))
        {
            try
            {
                string requestLine = ReadHeaderLine(reader);
                if (String.IsNullOrEmpty(requestLine)) return;
                string[] parts = requestLine.Split(' ');
                if (parts.Length < 2)
                {
                    WriteError(stream, 400, "Bad Request");
                    return;
                }

                string method = parts[0];
                string header;
                int headerSize = requestLine.Length;
                while (!String.IsNullOrEmpty(header = ReadHeaderLine(reader)))
                {
                    headerSize += header.Length;
                    if (headerSize > 32768) { WriteError(stream, 431, "Headers Too Large"); return; }
                }
                if (method != "GET" && method != "HEAD")
                {
                    WriteError(stream, 405, "Method Not Allowed");
                    return;
                }

                Uri uri = new Uri("http://localhost" + parts[1]);
                if (uri.AbsolutePath == "/_squoosh/version")
                {
                    byte[] version = Encoding.ASCII.GetBytes(ServerVersion());
                    WriteHeaders(stream, 200, "OK", "text/plain; charset=utf-8", version.Length);
                    if (method == "GET") stream.Write(version, 0, version.Length);
                    return;
                }
                string relativePath = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
                if (String.IsNullOrEmpty(relativePath)) relativePath = "index.html";
                string filePath = Path.GetFullPath(
                    Path.Combine(webRoot, relativePath.Replace('/', Path.DirectorySeparatorChar))
                );

                if (!filePath.StartsWith(webRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                {
                    WriteError(stream, 403, "Forbidden");
                    return;
                }
                if (!File.Exists(filePath))
                {
                    WriteError(stream, 404, "Not Found");
                    return;
                }

                byte[] data = File.ReadAllBytes(filePath);
                WriteHeaders(stream, 200, "OK", ContentType(filePath), data.Length);
                if (method == "GET") stream.Write(data, 0, data.Length);
            }
            catch
            {
                try { WriteError(stream, 500, "Internal Server Error"); } catch { }
            }
        }
    }

    private static void WriteError(Stream stream, int status, string message)
    {
        byte[] data = Encoding.UTF8.GetBytes(message);
        WriteHeaders(stream, status, message, "text/plain; charset=utf-8", data.Length);
        stream.Write(data, 0, data.Length);
    }

    private static void WriteHeaders(Stream stream, int status, string message, string contentType, int length)
    {
        string headers = String.Format(
            "HTTP/1.1 {0} {1}\r\nContent-Type: {2}\r\nContent-Length: {3}\r\n" +
            "Cache-Control: no-cache\r\nCross-Origin-Embedder-Policy: require-corp\r\n" +
            "Cross-Origin-Opener-Policy: same-origin\r\nConnection: close\r\n\r\n",
            status,
            message,
            contentType,
            length
        );
        byte[] data = Encoding.ASCII.GetBytes(headers);
        stream.Write(data, 0, data.Length);
    }

    private static string ContentType(string filePath)
    {
        switch (Path.GetExtension(filePath).ToLowerInvariant())
        {
            case ".avif": return "image/avif";
            case ".css": return "text/css; charset=utf-8";
            case ".html": return "text/html; charset=utf-8";
            case ".ico": return "image/x-icon";
            case ".jpg": return "image/jpeg";
            case ".js": return "text/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".png": return "image/png";
            case ".svg": return "image/svg+xml";
            case ".wasm": return "application/wasm";
            case ".webp": return "image/webp";
            default: return "application/octet-stream";
        }
    }

    private static string ReadHeaderLine(StreamReader reader)
    {
        var line = new StringBuilder();
        for (int length = 0; length < 8192; length++)
        {
            int character = reader.Read();
            if (character == -1 || character == '\n') return line.ToString().TrimEnd('\r');
            line.Append((char)character);
        }
        throw new InvalidDataException("HTTP header line too long");
    }

    private static void OpenBrowser()
    {
        if (!openBrowser) return;
        try
        {
            Process.Start("microsoft-edge:http://localhost:" + Port);
        }
        catch
        {
            Process.Start("http://localhost:" + Port);
        }
    }

    private static void ShowError(string message)
    {
        Environment.ExitCode = 1;
        if (!openBrowser) { Console.Error.WriteLine(message); return; }
        MessageBox.Show(message, "Squoosh 無法啟動", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
