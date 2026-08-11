import { expect, test } from "@playwright/test";

import { authConfig } from "../src/lib/auth/config";

const EIGHT_HOURS_IN_SECONDS = 60 * 60 * 8;

test.describe("Auth.js session yapılandırması", () => {
  test("session stratejisi JWT olarak kalıyor", async () => {
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  test("session maxAge 8 saat (28800 saniye) olarak ayarlanmış", async () => {
    expect(authConfig.session?.maxAge).toBe(EIGHT_HOURS_IN_SECONDS);
  });
});
