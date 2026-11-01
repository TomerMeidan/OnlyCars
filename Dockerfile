# The whole site in one image for Render (2026-11-01): the API, with the built web app in wwwroot.
FROM node:22 AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
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
ENTRYPOINT ["dotnet", "OnlyCars.Api.dll"]
