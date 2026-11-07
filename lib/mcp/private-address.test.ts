import { describe, expect, test } from "bun:test";
import { isPrivateAddress } from "./oauth";

describe("isPrivateAddress (client documents only from public hosts)", () => {
  test("blocks our own network", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });
  test("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "104.18.32.7", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});
