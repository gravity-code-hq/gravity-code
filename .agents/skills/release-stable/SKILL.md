---
name: release-stable
description: Cut a stable release of Gravity (fresh patch or minor, or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:minor", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

For this checkout, follow [Shipping from this fork](../../../docs/release.md#shipping-from-this-fork)
end-to-end. It owns the desktop-only flow, repository, parallel GitHub Actions builds,
and publication checks; the upstream npm/tag-push flow does not apply.

Follow [GitHub identity for pushes and releases](../../../docs/release.md#github-identity-for-pushes-and-releases):
