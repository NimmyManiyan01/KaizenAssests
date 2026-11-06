import { describe, it, expect, beforeEach } from "vitest";
import { getAuthToken, storeAuthSession, clearAuthSession, getUserInfo, hasRole, type UserInfo } from "@/lib/auth-utils";

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
});
