"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAuth } from "@/components/auth/auth-provider";
import { BrandMark } from "@/components/layout/sidebar";
import { Spinner } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { loginSchema, type LoginInput } from "@/lib/schemas";
import { t } from "@/lib/strings";

/** Brand panel — committed warm-dark look in both themes. */
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[oklch(0.19_0.025_50)] lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-10">
      {/* Warm glow, anchored bottom-left */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 8% 100%, oklch(0.45 0.13 50 / 0.5) 0%, oklch(0.3 0.07 50 / 0.22) 38%, transparent 70%)",
        }}
      />
      {/* Fine funnel-line texture */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1={-10 + i * 11}
            y1="110"
            x2={26 + i * 11}
            y2="-10"
            stroke="oklch(0.85 0.09 65)"
            strokeWidth="0.14"
          />
        ))}
      </svg>

      <div className="relative flex items-center gap-2.5">
        <BrandMark className="size-6 text-[oklch(0.79_0.13_62)]" />
        <span className="text-lg font-semibold tracking-tight text-[oklch(0.96_0.01_80)]">
          {t.app.name}
        </span>
      </div>

      <div className="relative flex flex-col gap-5">
        <h2 className="max-w-md text-3xl font-semibold leading-[1.15] tracking-tight text-[oklch(0.97_0.008_80)]">
          {t.auth.heroTitleStart}
          <br />
          <span className="text-[oklch(0.79_0.13_62)]">
            {t.auth.heroTitleAccent}
          </span>
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-[oklch(0.78_0.015_70)]">
          {t.auth.heroSubtitle}
        </p>
        {/* Brand ramp detail */}
        <div className="flex items-center gap-1.5" aria-hidden>
          {["#c65102", "#e2711d", "#ef9134", "#f9a11b", "#f7c325"].map(
            (c, i) => (
              <span
                key={c}
                className="h-1 rounded-full"
                style={{ background: c, width: 34 - i * 5 }}
              />
            ),
          )}
        </div>
      </div>

      <p className="relative text-xs text-[oklch(0.62_0.015_65)]">
        {t.app.description}
      </p>
    </div>
  );
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  React.useEffect(() => {
    if (!loading && user) router.replace("/negociacoes");
  }, [loading, user, router]);

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    try {
      await login(values.email, values.password);
      router.replace("/negociacoes");
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(
          err.status === 401 || err.status === 400
            ? err.userMessage === t.errors.generic
              ? t.auth.invalidCredentials
              : err.userMessage
            : err.userMessage,
        );
      } else {
        setServerError(t.auth.genericError);
      }
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <BrandPanel />

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[21rem]">
          {/* Compact brand for mobile / single-column */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <BrandMark className="size-5" />
            <span className="text-[15px] font-semibold tracking-tight">
              {t.app.name}
            </span>
          </div>

          <div className="mb-6 flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {t.auth.title}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {t.auth.subtitle}
            </p>
          </div>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t.auth.email}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="h-9"
                placeholder={t.auth.emailPlaceholder}
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t.auth.password}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-9"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>
            {serverError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-[13px] text-destructive"
              >
                {serverError}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="mt-1"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? t.auth.submitting : t.auth.submit}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
