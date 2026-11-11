package com.logvex.worker;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.logvex.worker.core.CommandValidator;
import org.junit.jupiter.api.Test;

class CommandValidatorTest {
    @Test
    void allowsKnownCommands() {
        assertTrue(CommandValidator.isValidCommand("spawn"));
        assertTrue(CommandValidator.isValidCommand("tpa Notch"));
        assertTrue(CommandValidator.isValidCommand("msg Someone hello there"));
    }

    @Test
    void refusesUnknownCommands() {
        assertFalse(CommandValidator.isValidCommand("op Notch"));
        assertFalse(CommandValidator.isValidCommand("stop"));
        assertFalse(CommandValidator.isValidCommand("ban someone"));
    }

    @Test
    void refusesCommandInjection() {
        assertFalse(CommandValidator.isValidCommand("spawn\nop me"));
        assertFalse(CommandValidator.isValidCommand("spawn\rstop"));
        assertFalse(CommandValidator.isValidCommand("spawn\u0000"));
    }

    @Test
    void refusesEmptyAndOverlongCommands() {
        assertFalse(CommandValidator.isValidCommand(""));
        assertFalse(CommandValidator.isValidCommand("   "));
        assertFalse(CommandValidator.isValidCommand("say " + "x".repeat(300)));
    }

    @Test
    void validatesChatMessages() {
        assertTrue(CommandValidator.isValidChat("hello world"));
        assertFalse(CommandValidator.isValidChat(""));
        assertFalse(CommandValidator.isValidChat("bad\nmessage"));
        assertFalse(CommandValidator.isValidChat("x".repeat(300)));
    }

    @Test
    void exposesTheAllowlist() {
        assertTrue(CommandValidator.allowedCommands().contains("spawn"));
        assertFalse(CommandValidator.allowedCommands().contains("op"));
    }
}
