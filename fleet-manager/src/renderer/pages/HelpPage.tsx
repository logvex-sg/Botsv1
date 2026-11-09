/**
 * Help.
 *
 * Short, beginner-friendly guidance: what the app does, the three-step getting-started flow, a
 * quick glossary and answers to the most common questions. Deliberately brief — the app should be
 * usable without it.
 */
import { Button, Card, Callout } from '../components/ui';
import type { PageId } from '../App';

interface Props { onNavigate: (page: PageId) => void }

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I get my first bot online?',
    a: 'Open the Dashboard and use Quick start to add an account and a server in one step. Then press "Start my bots".',
  },
  {
    q: 'Why is my account "not ready"?',
    a: 'Accounts on online servers need a stored password. Open Accounts, choose the account and add its password.',
  },
  {
    q: 'Do the bots fight automatically?',
    a: 'No. The Hunter only observes. Combat testing must be authorised per account, and only in a private test environment you control.',
  },
  {
    q: 'What is the Logvex Hunter addon?',
    a: 'A Minecraft mod that shares targets and combat events with this app. Connecting it is optional — everything else works without it.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In a local database on this computer. Passwords go to the operating system keychain, never into the database.',
  },
  {
    q: 'Something failed — what now?',
    a: 'Open Activity to see the exact message. Most failures are a wrong server address, a missing password, or a server that is offline.',
  },
];

export function HelpPage({ onNavigate }: Props) {
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="What this app does" sub="A plain-language overview.">
        <p className="card-sub" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Logvex Fleet Manager runs and watches Minecraft bots for you. You add an account and a
          server, press start, and the app handles connecting, reconnecting and reporting. Bots can
          take one of three roles: a <strong>Hunter</strong> that watches targets, a{' '}
          <strong>Gearer</strong> that keeps the squad equipped, or a <strong>Stasis</strong> bot that
          guards a location.
        </p>
      </Card>

      <div className="grid cols-3">
        <Card title="1. Add an account">
          <div className="card-sub">Give a bot a name and a server to join.</div>
          <div style={{ marginTop: 10 }}><Button small onClick={() => onNavigate('dashboard')}>Open Dashboard</Button></div>
        </Card>
        <Card title="2. Press start">
          <div className="card-sub">Pick the accounts you want online and press start.</div>
          <div style={{ marginTop: 10 }}><Button small onClick={() => onNavigate('tasks')}>Open Tasks</Button></div>
        </Card>
        <Card title="3. Watch it work">
          <div className="card-sub">See live status, events and statistics.</div>
          <div style={{ marginTop: 10 }}><Button small onClick={() => onNavigate('activity')}>Open Activity</Button></div>
        </Card>
      </div>

      <Callout tone="warning" title="Play fair">
        This tool is for managing your own accounts on servers that allow it. Do not use it to
        disrupt other players or to attack anyone. Combat testing is opt-in and off by default.
      </Callout>

      <Card title="Common questions">
        <div>
          {FAQ.map((item) => (
            <div key={item.q} className="faq">
              <div className="faq-q">{item.q}</div>
              <div className="faq-a">{item.a}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Words you will see">
        <div className="help-grid">
          <div><strong>Instance / bot</strong><div className="card-sub">One connected Minecraft client.</div></div>
          <div><strong>Account</strong><div className="card-sub">The Minecraft login a bot uses.</div></div>
          <div><strong>Server profile</strong><div className="card-sub">The address and settings of one server.</div></div>
          <div><strong>Deployment</strong><div className="card-sub">A saved plan for which bots to start.</div></div>
          <div><strong>Target</strong><div className="card-sub">A player the fleet keeps track of.</div></div>
          <div><strong>Hunter link</strong><div className="card-sub">The connection to the Hunter addon.</div></div>
        </div>
      </Card>
    </div>
  );
}
