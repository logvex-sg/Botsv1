package com.logvex.hunter.core;

import com.logvex.hunter.core.message.MessageEvent;
import com.logvex.hunter.core.message.MessageManager;
import com.logvex.hunter.core.message.MessageTemplate;
import com.logvex.hunter.core.message.Placeholders;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MessageManagerTest {
    /** A manager with every default template cleared, so tests control the templates exactly. */
    private static MessageManager empty() {
        MessageManager manager = new MessageManager(new Random(42));
        for (MessageEvent event : MessageEvent.values()) {
            manager.active().set(event, List.of());
        }
        return manager;
    }

    @Test
    void renderAppliesPlaceholders() {
        MessageManager manager = empty();
        manager.active().add(MessageEvent.TARGET_DETECTED, new MessageTemplate("{player} killed by logvex because you suck."));
        Map<String, String> values = Placeholders.build("Steve", 12.5, 18);

        MessageManager.Rendered rendered = manager.render(MessageEvent.TARGET_DETECTED, values, 1000);

        assertNotNull(rendered);
        assertEquals("Steve killed by logvex because you suck.", rendered.text());
    }

    @Test
    void cooldownSuppressesSecondRender() {
        MessageManager manager = empty();
        MessageTemplate template = new MessageTemplate("hi {player}");
        template.setCooldownSeconds(5);
        manager.active().add(MessageEvent.TARGET_DETECTED, template);
        Map<String, String> values = Placeholders.build("Steve", 1, 20);

        assertNotNull(manager.render(MessageEvent.TARGET_DETECTED, values, 1000));
        assertNull(manager.render(MessageEvent.TARGET_DETECTED, values, 2000));
        assertNotNull(manager.render(MessageEvent.TARGET_DETECTED, values, 1000 + 5_001));
    }

    @Test
    void disabledTemplateNeverRenders() {
        MessageManager manager = empty();
        MessageTemplate template = new MessageTemplate("hi");
        template.setEnabled(false);
        manager.active().add(MessageEvent.TARGET_DETECTED, template);

        assertNull(manager.render(MessageEvent.TARGET_DETECTED, Placeholders.build(), 1000));
    }

    @Test
    void eventWithoutTemplatesRendersNull() {
        MessageManager manager = empty();
        assertNull(manager.render(MessageEvent.STASIS_DANGER, Placeholders.build(), 1000));
    }

    @Test
    void defaultsShipWithEnabledTemplates() {
        MessageManager manager = new MessageManager();
        assertFalse(manager.active().templates(MessageEvent.TARGET_DETECTED).isEmpty());
        assertNotNull(manager.render(MessageEvent.TARGET_DETECTED, Placeholders.build("Alex", 5, 20), 1000));
    }

    @Test
    void previewListsEveryEnabledTemplate() {
        MessageManager manager = empty();
        manager.active().add(MessageEvent.TARGET_DETECTED, new MessageTemplate("one {player}"));
        manager.active().add(MessageEvent.TARGET_DETECTED, new MessageTemplate("two {player}"));
        MessageTemplate disabled = new MessageTemplate("three {player}");
        disabled.setEnabled(false);
        manager.active().add(MessageEvent.TARGET_DETECTED, disabled);

        var preview = manager.preview(MessageEvent.TARGET_DETECTED, Placeholders.build("Alex", 5, 20));

        assertEquals(2, preview.size());
        assertEquals(2, preview.stream().filter(s -> s.contains("Alex")).count());
    }

    @Test
    void profileCreationAndDeletion() {
        MessageManager manager = empty();
        manager.active().add(MessageEvent.TARGET_DETECTED, new MessageTemplate("base"));

        assertNotNull(manager.createProfile("aggressive", true));
        assertTrue(manager.profileNames().contains("aggressive"));
        assertEquals(1, manager.profile("aggressive").templates(MessageEvent.TARGET_DETECTED).size());

        assertTrue(manager.deleteProfile("aggressive"));
        assertFalse(manager.profileNames().contains("aggressive"));
    }

    @Test
    void lastProfileCannotBeDeleted() {
        MessageManager manager = new MessageManager();
        assertFalse(manager.deleteProfile(manager.activeProfileName()));
    }

    @Test
    void jsonRoundTripPreservesTemplates() {
        MessageManager manager = empty();
        MessageTemplate template = new MessageTemplate("{player} is here");
        template.setCooldownSeconds(7);
        manager.active().add(MessageEvent.TARGET_DETECTED, template);

        MessageManager restored = MessageManager.fromJson(manager.toJson());

        var templates = restored.active().templates(MessageEvent.TARGET_DETECTED);
        assertEquals(1, templates.size());
        assertEquals("{player} is here", templates.get(0).text());
        assertEquals(7, templates.get(0).cooldownSeconds());
    }
}
