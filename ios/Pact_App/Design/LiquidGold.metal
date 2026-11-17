#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Liquid gold and silver, the same as the website's backdrop: folded noise lit like poured metal, kept faint.

static float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

static float noise(float2 p) {
    float2 i = floor(p), f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}

static float fbm(float2 p) {
    float v = 0.0, a = 0.5;
    float2x2 m = float2x2(float2(1.5, -1.1), float2(1.1, 1.5));
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
}

static float surface(float2 p, float t) {
    float2 q = float2(fbm(p + float2(0.0, t * 0.035)), fbm(p + float2(5.2, 1.3) - t * 0.03));
    float2 r = float2(fbm(p + 1.6 * q + float2(1.7, 9.2) + t * 0.02), fbm(p + 1.6 * q + float2(8.3, 2.8)));
    return fbm(p + 1.4 * r);
}

[[ stitchable ]] half4 liquidGold(float2 position, half4 color, float2 size, float t) {
    // Flip y so the brightest gold sits at the top, like the website.
    float2 uv = float2(position.x / size.x, 1.0 - position.y / size.y);
    float2 p = (float2(position.x, size.y - position.y) - 0.5 * size) / size.y * 0.75 + float2(0.0, 0.3);
    float h = surface(p, t);
    float e = 0.012;
    float3 n = normalize(float3(surface(p + float2(e, 0), t) - h, surface(p + float2(0, e), t) - h, e * 0.9));
    float3 light = normalize(float3(-0.4, 0.6, 0.7));
    float diff = clamp(dot(n, light), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-light, n), float3(0, 0, 1)), 0.0, 1.0), 10.0) * 0.8;
    float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);

    float3 silver = float3(0.78, 0.78, 0.80);
    float3 gold = float3(1.0, 0.86, 0.62);
    float3 deep = float3(0.16, 0.14, 0.12);
    float goldness = smoothstep(0.3, 0.7, h + 0.18 * sin(h * 5.0 + t * 0.08));
    float3 base = mix(silver, gold, 0.12 + 0.5 * goldness);
    float3 col = mix(deep, base, 0.25 + 0.75 * diff) + spec * float3(1.0, 0.95, 0.85) + rim * gold * 0.35;
    // Mostly black: faint in the middle and upper part, falling off to black at every edge.
    float fade = mix(0.05, 0.22, smoothstep(0.05, 1.0, uv.y));
    float2 c = (uv - float2(0.5, 0.6)) * float2(size.x / size.y * 0.9, 1.15);
    float vignette = smoothstep(0.95, 0.15, length(c));
    return half4(half3(col * fade * vignette), 1.0);
}
