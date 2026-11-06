# The whole site in one image for Render (2026-11-01): the API, with the built web app in wwwroot.
FROM node:22 AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# ERR-1: Render passes the service's env vars to the build as build args; Vite reads them while building. Empty: no Sentry, no release.
ARG VITE_SENTRY_DSN
ARG RENDER_GIT_COMMIT
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY src/ ./
RUN dotnet publish OnlyCars.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=client /client/dist ./wwwroot
# Render sends traffic to port 10000 unless told otherwise.
ENV ASPNETCORE_HTTP_PORTS=10000
EXPOSE 10000
# The image's own unprivileged user, not root (audit 2026-11-02).
USER $APP_UID
ENTRYPOINT ["dotnet", "OnlyCars.Api.dll"]
