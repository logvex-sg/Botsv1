package com.logvex.hunter.core.model;

import java.util.Locale;

/** An immutable, Minecraft-free 3D position. */
public final class Vec3 {
    public static final Vec3 ZERO = new Vec3(0, 0, 0);

    public final double x;
    public final double y;
    public final double z;

    public Vec3(double x, double y, double z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public double distanceTo(Vec3 other) {
        if (other == null) return Double.NaN;
        double dx = x - other.x;
        double dy = y - other.y;
        double dz = z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public double horizontalDistanceTo(Vec3 other) {
        if (other == null) return Double.NaN;
        double dx = x - other.x;
        double dz = z - other.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /** A shortened coordinate string such as {@code 123 64 -45}. */
    public String shortString() {
        return String.format(Locale.ROOT, "%.0f %.0f %.0f", x, y, z);
    }

    @Override
    public String toString() {
        return String.format(Locale.ROOT, "(%.2f, %.2f, %.2f)", x, y, z);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Vec3 v)) return false;
        return Double.compare(v.x, x) == 0 && Double.compare(v.y, y) == 0 && Double.compare(v.z, z) == 0;
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(x, y, z);
    }
}
