using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Configuration;
using OnlyCars.Application.Common;

namespace OnlyCars.Infrastructure.Storage;

/// <summary>Cloudflare R2 over its S3-compatible API. Settings: <c>R2:AccountId</c>, <c>AccessKeyId</c>, <c>SecretAccessKey</c>, <c>BucketName</c>.</summary>
public sealed class R2FileStorage(IAmazonS3 s3, string bucket) : IFileStorage
{
    /// <summary>The storage, or null when any R2 setting is missing (the API still runs; photo endpoints answer 503).</summary>
    public static R2FileStorage? FromConfiguration(IConfiguration configuration)
    {
        var r2 = configuration.GetSection("R2");
        string?[] values = [r2["AccountId"], r2["AccessKeyId"], r2["SecretAccessKey"], r2["BucketName"]];
        if (values.Any(string.IsNullOrWhiteSpace))
        {
            return null;
        }

        var s3 = new AmazonS3Client(new BasicAWSCredentials(r2["AccessKeyId"], r2["SecretAccessKey"]), new AmazonS3Config
        {
            ServiceURL = $"https://{r2["AccountId"]}.r2.cloudflarestorage.com",
            ForcePathStyle = true,
            AuthenticationRegion = "auto",
            // R2 rejects the SDK's default trailing checksums (Cloudflare's AWS SDK for .NET notes).
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED
        });
        return new R2FileStorage(s3, r2["BucketName"]!);
    }

    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken ct = default)
    {
        using var body = new MemoryStream(content, writable: false);
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = body,
            ContentType = contentType,
            DisablePayloadSigning = true, // R2 doesn't support streaming SigV4 payload signing
            DisableDefaultChecksumValidation = true
        }, ct);
    }

    public async Task DeleteAsync(string key, CancellationToken ct = default) =>
        await s3.DeleteObjectAsync(bucket, key, ct);

    public string GetSignedUrl(string key, TimeSpan validFor, string? contentType = null, string? contentDisposition = null)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(validFor)
        };
        request.ResponseHeaderOverrides.ContentType = contentType;
        request.ResponseHeaderOverrides.ContentDisposition = contentDisposition;
        // Private files: a shared cache must not keep them, and the browser may not keep them past the URL.
        request.ResponseHeaderOverrides.CacheControl = "private, max-age=3600";
        return s3.GetPreSignedURL(request);
    }
}
