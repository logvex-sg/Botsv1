package com.logvex.hunter.hud;

import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.mc.HunterRuntime;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.ColorSetting;
import meteordevelopment.meteorclient.settings.DoubleSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.systems.hud.HudElement;
import meteordevelopment.meteorclient.systems.hud.HudElementInfo;
import meteordevelopment.meteorclient.systems.hud.HudRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.meteorclient.utils.render.color.SettingColor;

import java.util.List;

/** Shared configuration and rendering helpers for the addon's HUD elements. */
public abstract class HunterHudElement extends HudElement {
    protected final SettingGroup sgGeneral = settings.getDefaultGroup();
    protected final SettingGroup sgScale = settings.createGroup("Scale");
    protected final SettingGroup sgBackground = settings.createGroup("Background");

    protected final Setting<Boolean> shadow = sgGeneral.add(new BoolSetting.Builder()
        .name("shadow").description("Render a shadow behind the text.").defaultValue(true).build());

    protected final Setting<Boolean> customScale = sgScale.add(new BoolSetting.Builder()
        .name("custom-scale").description("Apply a custom scale to this element.").defaultValue(false).build());

    protected final Setting<Double> scale = sgScale.add(new DoubleSetting.Builder()
        .name("scale").description("Custom scale.").defaultValue(1).min(0.5).sliderRange(0.5, 3)
        .visible(customScale::get).build());

    protected final Setting<Boolean> background = sgBackground.add(new BoolSetting.Builder()
        .name("background").description("Draw a background behind the element.").defaultValue(true).build());

    protected final Setting<SettingColor> backgroundColor = sgBackground.add(new ColorSetting.Builder()
        .name("background-color").description("Background colour.").defaultValue(new SettingColor(0, 0, 0, 100))
        .visible(background::get).build());

    protected HunterHudElement(HudElementInfo<?> info) {
        super(info);
    }

    protected HunterCore core() {
        return HunterRuntime.get().core();
    }

    protected double getScale() {
        return customScale.get() ? scale.get() : 1;
    }

    /** Draws a title plus lines, sized to fit, and returns the height used. */
    protected double renderBlock(HudRenderer renderer, String title, List<String> lines, Color titleColor) {
        boolean sh = shadow.get();
        double s = getScale();
        double lineHeight = renderer.textHeight(sh, s);

        double width = renderer.textWidth(title, sh, s);
        for (String line : lines) width = Math.max(width, renderer.textWidth(line, sh, s));
        double height = lineHeight * (lines.isEmpty() ? 1 : lines.size() + 1);
        setSize(width, height);

        double drawX = x;
        double drawY = y;
        if (background.get()) {
            renderer.quad(drawX, drawY, width, height, backgroundColor.get());
        }

        renderer.text(title, drawX, drawY, titleColor, sh, s);
        drawY += lineHeight;
        Color color = Color.WHITE;
        for (String line : lines) {
            renderer.text(line, drawX, drawY, color, sh, s);
            drawY += lineHeight;
        }
        return height;
    }

    protected String yesNo(boolean value) {
        return value ? "yes" : "no";
    }
}
