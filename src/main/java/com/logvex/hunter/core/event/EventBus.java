package com.logvex.hunter.core.event;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * A small synchronous publish/subscribe bus.
 *
 * <p>The addon uses it to decouple the game layer (which produces tracking and combat events) from
 * the dashboard, statistics, chat and instance layers (which consume them). A listener that throws
 * is isolated: the exception is reported and the remaining listeners still run, so one broken
 * consumer cannot stop the others.
 */
public final class EventBus {
    public interface Listener<T> {
        void onEvent(T event);
    }

    /** Handle returned by {@link #subscribe}; call {@link #close()} to stop receiving events. */
    public interface Subscription extends AutoCloseable {
        @Override
        void close();

        boolean active();
    }

    private final Map<Class<?>, CopyOnWriteArrayList<Listener<?>>> listeners = new ConcurrentHashMap<>();
    private final Consumer<Throwable> errorHandler;
    private volatile boolean posting;

    public EventBus() {
        this(t -> {});
    }

    public EventBus(Consumer<Throwable> errorHandler) {
        this.errorHandler = errorHandler == null ? t -> {} : errorHandler;
    }

    public <T> Subscription subscribe(Class<T> type, Listener<T> listener) {
        CopyOnWriteArrayList<Listener<?>> list = listeners.computeIfAbsent(type, k -> new CopyOnWriteArrayList<>());
        list.add(listener);
        return new SubscriptionImpl(type, listener);
    }

    public void post(Object event) {
        if (event == null) return;
        posting = true;
        try {
            for (Class<?> type : matchingTypes(event.getClass())) {
                CopyOnWriteArrayList<Listener<?>> list = listeners.get(type);
                if (list == null) continue;
                for (Listener<?> listener : list) {
                    dispatch(listener, event);
                }
            }
        } finally {
            posting = false;
        }
    }

    @SuppressWarnings("unchecked")
    private void dispatch(Listener<?> listener, Object event) {
        try {
            ((Listener<Object>) listener).onEvent(event);
        } catch (Throwable t) {
            errorHandler.accept(t);
        }
    }

    /** The event's own class plus every superclass and interface, so base-type listeners work. */
    private List<Class<?>> matchingTypes(Class<?> type) {
        List<Class<?>> types = new ArrayList<>();
        for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
            types.add(c);
            collectInterfaces(c, types);
        }
        return types;
    }

    private void collectInterfaces(Class<?> type, List<Class<?>> out) {
        for (Class<?> iface : type.getInterfaces()) {
            if (!out.contains(iface)) {
                out.add(iface);
                collectInterfaces(iface, out);
            }
        }
    }

    public int listenerCount() {
        int total = 0;
        for (CopyOnWriteArrayList<Listener<?>> list : listeners.values()) total += list.size();
        return total;
    }

    public boolean isPosting() {
        return posting;
    }

    public void clear() {
        listeners.clear();
    }

    private final class SubscriptionImpl implements Subscription {
        private final Class<?> type;
        private final Listener<?> listener;
        private volatile boolean active = true;

        SubscriptionImpl(Class<?> type, Listener<?> listener) {
            this.type = type;
            this.listener = listener;
        }

        @Override
        public void close() {
            if (!active) return;
            active = false;
            CopyOnWriteArrayList<Listener<?>> list = listeners.get(type);
            if (list != null) list.remove(listener);
        }

        @Override
        public boolean active() {
            return active;
        }
    }
}
