using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace SirAgent.Core.Tests;

/// <summary>
/// The requests built by the C# agent are valid for the JSON Schemas generated from the zod schemas of
/// `packages/shared` (`apps/agent-dotnet/schemas`), and what the schemas refuse the agent never queues.
/// </summary>
public sealed class SchemaTests
{
    private const string Ingest = "ingest-request.schema.json";
    private static readonly string Hash = new('a', 64);

    private static string ToJson(IngestRequest r)
    {
        var (body, gzip) = Sender.Encode(r);
        if (!gzip) return Encoding.UTF8.GetString(body);
        using var input = new GZipStream(new MemoryStream(body), CompressionMode.Decompress);
        using var output = new MemoryStream();
        input.CopyTo(output);
        return Encoding.UTF8.GetString(output.ToArray());
    }

    [Fact]
    public void Le_costanti_coincidono_con_quelle_di_packages_shared()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo.SchemaDir, "agent-constants.json")));
        var c = doc.RootElement;
        Assert.Equal(Contract.IngestProtocol, c.GetProperty("ingestProtocol").GetInt32());
        Assert.Equal(Contract.IngestMaxLines, c.GetProperty("ingestMaxLines").GetInt32());
        Assert.Equal(Contract.IngestMaxLineLength, c.GetProperty("ingestMaxLineLength").GetInt32());
        Assert.Equal(Contract.IngestMaxHeaderLength, c.GetProperty("ingestMaxHeaderLength").GetInt32());
        Assert.Equal(Dvw.ScoutSectionMarker, c.GetProperty("scoutSectionMarker").GetString());
        Assert.Equal(Contract.AgentExpiredError, c.GetProperty("agentExpiredError").GetString());
        Assert.Equal(Contract.PairingCodeAlphabet, c.GetProperty("pairingCodeAlphabet").GetString());
        Assert.Equal(Contract.PairingCodeLength, c.GetProperty("pairingCodeLength").GetInt32());
        Assert.Equal(Contract.AgentBrandingVersion, c.GetProperty("agentBrandingVersion").GetInt32());
        Assert.Equal(Contract.AgentLogoMaxBytes, c.GetProperty("agentLogoMaxBytes").GetInt32());
        Assert.Equal(Contract.AgentLogoMaxSide, c.GetProperty("agentLogoMaxSide").GetInt32());
    }

    [Fact]
    public void Ogni_richiesta_pianificata_sul_riferimento_rispetta_lo_schema()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "riferimento-node.json")));
        var checkedRequests = 0;
        foreach (var c in doc.RootElement.GetProperty("cases").EnumerateArray())
        {
            if (Dvw.Read(Convert.FromBase64String(c.GetProperty("bytesBase64").GetString()!)) is not DvwRead.Content read) continue;
            var key = Dvw.DeriveMatchKey(read.Value.Header, c.GetProperty("filePath").GetString()!);
            var previous = new DvwContent(read.Value.Header, read.Value.Lines.Take(Math.Max(0, read.Value.Lines.Count - 2)).ToList());
            var seq = 0L;
            foreach (var plan in ScoutSync.PlanRequests(null, read.Value, maxLines: 7).Concat(ScoutSync.PlanRequests(previous, read.Value)))
            {
                var request = ScoutSync.ToRequest(key, seq++, plan);
                Assert.Empty(IngestValidator.Problems(request));
                Assert.True(Repo.IsValid(Ingest, ToJson(request)), $"{c.GetProperty("name")}: {ToJson(request)[..Math.Min(200, ToJson(request).Length)]}");
                checkedRequests++;
            }
        }
        Assert.True(checkedRequests > 20);
    }

    [Fact]
    public void Richiesta_grande_compressa_resta_valida()
    {
        var lines = Enumerable.Range(0, 400).Select(i => $"*{i % 20:00}SM-;;;;;;;18.00.01;1;1;6;1;100;;7;14;18;2;17;12;6;8;5;3;9;11;").ToList();
        var request = ScoutSync.ToRequest("chiave_1", 3, ScoutSync.PlanRequests(null, new DvwContent("[3MATCH]\n", lines))[0]);
        var (_, gzip) = Sender.Encode(request);
        Assert.True(gzip);
        Assert.True(Repo.IsValid(Ingest, ToJson(request)));
    }

    public static TheoryData<string, string> Invalid() => new()
    {
        { "snapshot senza header", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"snapshot","fromIndex":0,"lines":[],"contentHash":"{{Hash}}"}""" },
        { "snapshot con fromIndex", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"snapshot","fromIndex":2,"lines":[],"header":"","contentHash":"{{Hash}}"}""" },
        { "riga con a capo", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"append","fromIndex":0,"lines":["a\nb"],"contentHash":"{{Hash}}"}""" },
        { "riga che apre una sezione", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"append","fromIndex":0,"lines":["  [3SCOUT] "],"contentHash":"{{Hash}}"}""" },
        { "riga con NUL", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"append","fromIndex":0,"lines":["a\u0000"],"contentHash":"{{Hash}}"}""" },
        { "header con [3SCOUT]", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"snapshot","fromIndex":0,"lines":[],"header":"x\n[3SCOUT]\n","contentHash":"{{Hash}}"}""" },
        { "matchKey non valida", $$"""{"protocol":1,"matchKey":"a b","seq":0,"kind":"append","fromIndex":0,"lines":[],"contentHash":"{{Hash}}"}""" },
        { "hash maiuscolo", $$"""{"protocol":1,"matchKey":"k","seq":0,"kind":"append","fromIndex":0,"lines":[],"contentHash":"{{new string('A', 64)}}"}""" },
        { "seq negativo", $$"""{"protocol":1,"matchKey":"k","seq":-1,"kind":"append","fromIndex":0,"lines":[],"contentHash":"{{Hash}}"}""" },
        { "protocollo 2", $$"""{"protocol":2,"matchKey":"k","seq":0,"kind":"append","fromIndex":0,"lines":[],"contentHash":"{{Hash}}"}""" },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public void Schema_e_validatore_rifiutano_le_stesse_richieste(string why, string json)
    {
        Assert.False(Repo.IsValid(Ingest, json), why);
        var request = JsonSerializer.Deserialize<IngestRequest>(json, Json.Compact)!;
        Assert.NotEmpty(IngestValidator.Problems(request));
    }

    [Fact]
    public void Corpo_della_registrazione_valido_per_lo_schema()
    {
        const string schema = "create-registration-request.schema.json";
        Assert.True(Repo.IsValid(schema, RegistrationBodies.Create("PC Palazzetto")));
        Assert.True(Repo.IsValid(schema, RegistrationBodies.Create(new string('x', 100))));
        Assert.False(Repo.IsValid(schema, RegistrationBodies.Create("   ")));
        Assert.False(Repo.IsValid(schema, RegistrationBodies.Create("a\tb")));
        Assert.Null(RegistrationFormats.PlainText("   "));
        Assert.Null(RegistrationFormats.PlainText("a\tb"));
        Assert.Equal("PC 1", RegistrationFormats.PlainText("  PC 1 "));
    }

    public static TheoryData<string, string> Answers() => new()
    {
        { "ingest-response.schema.json", $$"""{"status":"ok","seq":4,"lineCount":10,"contentHash":"{{Hash}}"}""" },
        { "ingest-response.schema.json", """{"status":"needSnapshot","seq":-1,"lineCount":0}""" },
        { "ingest-response.schema.json", """{"status":"strano","seq":1,"lineCount":0}""" },
        { "ingest-response.schema.json", """{"status":"ok","seq":-2,"lineCount":0}""" },
        { "ingest-response.schema.json", """{"status":"ok","seq":1.5,"lineCount":0}""" },
        { "registration-status-response.schema.json", """{"status":"pending","expiresAt":"2026-10-17T10:00:00.000Z"}""" },
        { "registration-status-response.schema.json", """{"status":"pending","expiresAt":"2026-10-17 10:00"}""" },
        { "registration-status-response.schema.json", """{"status":"approved","token":"abcdefghijklmnopqrstuvwxyz012345","agentId":"5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"}""" },
        { "registration-status-response.schema.json", """{"status":"approved","token":"corto","agentId":"5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"}""" },
        { "registration-status-response.schema.json", """{"status":"rejected"}""" },
        { "registration-status-response.schema.json", """{"status":"altro"}""" },
        { "create-registration-response.schema.json", """{"registrationId":"5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e","secret":"abcdefghijklmnopqrstuvwxyz012345","pairingCode":"ABC234","expiresAt":"2026-10-17T10:00:00Z"}""" },
        { "create-registration-response.schema.json", """{"registrationId":"5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e","secret":"abcdefghijklmnopqrstuvwxyz012345","pairingCode":"ABC10O","expiresAt":"2026-10-17T10:00:00Z"}""" },
    };

    /// <summary>The answers accepted by the agent are exactly those valid for the schemas.</summary>
    [Theory]
    [MemberData(nameof(Answers))]
    public void Le_risposte_accettate_sono_quelle_valide_per_lo_schema(string schema, string json)
    {
        var valid = Repo.IsValid(schema, json);
        using var doc = JsonDocument.Parse(json);
        var parsed = schema switch
        {
            "ingest-response.schema.json" => (object?)ResponseValidator.ParseIngestResponse(json),
            "registration-status-response.schema.json" => RegistrationClient.ParseStatus(doc.RootElement),
            _ => RegistrationClient.ParseCreated(doc.RootElement),
        };
        Assert.Equal(valid, parsed is not null);
    }

    [Fact]
    public void Branding_valido_per_lo_schema_e_per_l_agente()
    {
        const string ok = """{"version":1,"name":"Sir Susa","colors":{"primary":"#1e4db0","onPrimary":"#ffffff","accent":"#e30613","onAccent":"#ffffff","background":"#f5f5f5","onBackground":"#111111"}}""";
        Assert.True(Repo.IsValid("agent-branding.schema.json", ok));
        Assert.NotNull(Branding.ParseBranding(ok));
        var extra = ok.Replace("\"version\":1,", "\"version\":1,\"x\":1,", StringComparison.Ordinal);
        Assert.False(Repo.IsValid("agent-branding.schema.json", extra));
        Assert.Null(Branding.ParseBranding(extra));
    }
}
