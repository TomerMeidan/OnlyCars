using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Api.Common;

/// <summary>Reads the one file field <c>file</c> of an upload endpoint marked <see cref="DisableFormValueBindingAttribute"/>.</summary>
public static class UploadedFile
{
    /// <summary>
    /// The file's bytes and its name as sent, or nulls when there is no file, the body isn't multipart or it is malformed
    /// (the service answers <c>file.required</c>). A body over the endpoint's RequestSizeLimit throws <paramref name="tooLarge"/>.
    /// </summary>
    public static async Task<(byte[]? Content, string? FileName)> ReadAsync(HttpRequest request, Func<AppException> tooLarge, CancellationToken ct)
    {
        try
        {
            if (request.HasFormContentType && (await request.ReadFormAsync(ct)).Files.GetFile("file") is { } file)
            {
                var content = new byte[file.Length]; // one copy, sized up front; RequestSizeLimit bounds it
                await using var stream = file.OpenReadStream();
                await stream.ReadExactlyAsync(content, ct);
                return (content, file.FileName);
            }
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw tooLarge();
        }
        catch (InvalidDataException)
        {
            // Malformed multipart: treated as no file.
        }

        return (null, null);
    }
}
