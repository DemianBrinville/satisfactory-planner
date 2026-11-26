// Lee el mapa del juego instalado con CUE4Parse y escribe los yacimientos (posición, recurso y pureza),
// los pozos (núcleo y satélites), los géiseres y los límites del mapa (actor de captura del minimapa).
//
// Uso:  dotnet run -c Release -- "<carpeta de Satisfactory>" <salida.json>
// Satisfactory 1.2 usa Unreal Engine 5.6. El FactoryGame.usmap oficial (CommunityResources) guarda las
// propiedades Optional sin su tipo interior, y CUE4Parse lo espera: se arma una copia corregida en memoria.
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;

if (args.Length < 2)
{
    Console.Error.WriteLine("uso: MapExtract <carpeta de Satisfactory> <salida.json>");
    return 1;
}
var game = args[0];
var usmap = Path.Combine(Path.GetTempPath(), "FactoryGame.patched.usmap");
File.WriteAllBytes(usmap, PatchUsmap(File.ReadAllBytes(Path.Combine(game, "CommunityResources", "FactoryGame.usmap"))));

var provider = new DefaultFileProvider(Path.Combine(game, "FactoryGame", "Content", "Paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(EGame.GAME_UE5_6), StringComparer.OrdinalIgnoreCase);
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap, StringComparer.OrdinalIgnoreCase);
provider.Initialize();
provider.Mount();

var wanted = new HashSet<string> { "BP_ResourceNode_C", "BP_ResourceNodeGeyser_C", "BP_FrackingSatellite_C", "BP_FrackingCore_C", "BP_MinimapCaptureActor_C" };
var list = new List<object>();
int fails = 0;
foreach (var file in provider.Files.Keys.Where(k => k.Contains("Map/GameLevel01/Persistent_Level") && k.EndsWith(".umap")))
{
    CUE4Parse.UE4.Assets.IPackage pkg;
    try { pkg = provider.LoadPackage(file); } catch { fails++; continue; }
    foreach (var e in pkg.GetExports())
    {
        if (!wanted.Contains(e.ExportType)) continue;
        var loc = e.GetOrDefault<UObject>("RootComponent")?.GetOrDefault<FVector>("RelativeLocation");
        object Prop(string n) => e.Properties.FirstOrDefault(p => p.Name.Text == n)?.Tag?.GenericValue;
        string ortho = null;
        if (e.ExportType == "BP_MinimapCaptureActor_C")
            ortho = e.GetOrDefault<UObject>("CaptureComponent2D")?.Properties.FirstOrDefault(p => p.Name.Text == "OrthoWidth")?.Tag?.GenericValue?.ToString();
        list.Add(new
        {
            type = e.ExportType,
            name = e.Name,
            resource = (Prop("mResourceClass") as FPackageIndex)?.Name,
            // sin valor = el de la clase: RP_Normal
            purity = Prop("mPurity")?.ToString() ?? "RP_Normal",
            core = (Prop("mCore") as FPackageIndex)?.Name,
            x = loc?.X, y = loc?.Y, z = loc?.Z,
            orthoWidth = ortho,
        });
    }
}
File.WriteAllText(args[1], JsonConvert.SerializeObject(list));
Console.WriteLine($"{list.Count} objetos ({fails} celdas sin leer) -> {args[1]}");
return 0;

/// Inserta el tipo interior que falta en las propiedades Optional (tipo 28) del usmap.
static byte[] PatchUsmap(byte[] f)
{
    int p = 3;
    int I32() { var v = BitConverter.ToInt32(f, p); p += 4; return v; }
    ushort U16() { var v = BitConverter.ToUInt16(f, p); p += 2; return v; }
    byte U8() => f[p++];
    if (I32() != 0) { p += 8; var n = I32(); p += n * 20; p += 4; }
    int compAt = p;
    p += 9;
    var names = new List<string>();
    var nameCount = I32();
    for (int i = 0; i < nameCount; i++) { int l = U8(); names.Add(System.Text.Encoding.UTF8.GetString(f, p, l)); p += l; }
    var enums = I32();
    for (int i = 0; i < enums; i++) { I32(); int c = U8(); p += 4 * c; }
    var inserts = new SortedDictionary<int, byte[]>();
    int box = names.IndexOf("Box");
    void Type(string owner)
    {
        var t = U8();
        if (t == 28) { inserts[p] = owner.EndsWith("CellBounds") && box >= 0 ? new byte[] { 9 }.Concat(BitConverter.GetBytes(box)).ToArray() : new byte[] { 1 }; return; }
        if (t == 8 || t == 25) Type(owner);
        else if (t == 9) I32();
        else if (t == 24) { Type(owner); Type(owner); }
        else if (t == 26) { Type(owner); I32(); }
    }
    var structs = I32();
    for (int i = 0; i < structs; i++)
    {
        var sname = names[I32()]; I32(); U16(); var props = U16();
        for (int k = 0; k < props; k++) { U16(); U8(); var pn = I32(); Type(sname + "." + names[pn]); }
    }
    var outp = new List<byte>(f.Length + inserts.Count * 5);
    int last = 0;
    foreach (var (pos, bytes) in inserts) { outp.AddRange(f[last..pos]); outp.AddRange(bytes); last = pos; }
    outp.AddRange(f[last..]);
    var res = outp.ToArray();
    int added = res.Length - f.Length;
    BitConverter.GetBytes(BitConverter.ToUInt32(res, compAt + 1) + (uint)added).CopyTo(res, compAt + 1);
    BitConverter.GetBytes(BitConverter.ToUInt32(res, compAt + 5) + (uint)added).CopyTo(res, compAt + 5);
    return res;
}
