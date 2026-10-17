using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace OnlyCars.Api.Common;

/// <summary>
/// Stops MVC reading the form before the action, so the action reads it itself and can turn the body-size 413
/// into a coded error (MVC would make it a plain 400). The pattern from the ASP.NET Core large-upload docs.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DisableFormValueBindingAttribute : Attribute, IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        context.ValueProviderFactories.RemoveType<FormValueProviderFactory>();
        context.ValueProviderFactories.RemoveType<FormFileValueProviderFactory>();
        context.ValueProviderFactories.RemoveType<JQueryFormValueProviderFactory>();
    }

    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
