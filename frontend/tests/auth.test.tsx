import { describe, it, expect, beforeEach } from "vitest";
import { getAuthToken, storeAuthSession, clearAuthSession, getUserInfo, hasRole, type UserInfo } from "@/lib/auth-utils";
import { formatToIST } from "@/lib/utils";

describe("Frontend Authentication Utils", () => {
  beforeEach(() => {
    clearAuthSession();
  });

  it("stores and retrieves auth session in sessionStorage", () => {
    const mockUser: UserInfo = {
      token: "mock-jwt-db-user-test-token-12345",
      username: "admin",
      roles: ["ADMIN"],
      full_name: "System Admin",
      employee_id: "EMP-001",
    };

    storeAuthSession(mockUser, false);

    expect(getAuthToken()).toBe("mock-jwt-db-user-test-token-12345");
    const retrieved = getUserInfo();
    expect(retrieved?.username).toBe("admin");
    expect(retrieved?.roles).toEqual(["ADMIN"]);
  });

  it("clears auth session cleanly", () => {
    const mockUser: UserInfo = {
      token: "mock-jwt-db-user-test-token-12345",
      username: "admin",
      roles: ["ADMIN"],
    };

    storeAuthSession(mockUser, false);
    clearAuthSession();

    expect(getAuthToken()).toBeNull();
    expect(getUserInfo()).toBeNull();
  });

  it("evaluates admin roles correctly with hasRole", () => {
    const mockUser: UserInfo = {
      token: "mock-jwt-db-user-test-token-12345",
      username: "admin",
      roles: ["SUPER_ADMIN"],
    };

    storeAuthSession(mockUser, false);
    expect(hasRole("ADMIN")).toBe(true);
    expect(hasRole("WAREHOUSE_MANAGER")).toBe(true);
  });

  describe("formatToIST", () => {
    it("formats UTC timestamp strings to IST standards (UTC+5:30)", () => {
      // 04:31:47 UTC should become 10:01:47 am IST
      const result = formatToIST("2026-11-16T04:31:47.559407Z");
      expect(result).toMatch(/16\/11\/2026,\s*10:01:47\s*am/i);
    });

    it("formats naive UTC strings to IST standards without local drift", () => {
      const result = formatToIST("2026-11-16T04:31:47.559407");
      expect(result).toMatch(/16\/11\/2026,\s*10:01:47\s*am/i);
    });

    it("returns 'Never' for falsy or missing timestamps", () => {
      expect(formatToIST(null)).toBe("Never");
      expect(formatToIST(undefined)).toBe("Never");
      expect(formatToIST("")).toBe("Never");
    });
  });
});
