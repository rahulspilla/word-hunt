import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './style.css';

const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;
const COLORS = { correct: 'green', present: 'yellow', absent: 'gray' };

function App() {
  const [screen, setScreen] = useState('home');
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [secret, setSecret] = useState('');
  const [game, setGame] = useState(null);
  const [guesses, setGuesses] = useState([]);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const playerId = useMemo(() => {
    let id = sessionStorage.getItem('wh-player-id');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('wh-player-id', id); }
    return id;
  }, []);

  const ready = !!supabase;
  const setProblem = (e) => setError(e?.message || String(e));

  async function createRoom() {
    if (!ready) return setError('Connect your Supabase project first. See README.md.');
    if (!name.trim() || !/^[A-Za-z]{5}$/.test(secret)) return setError('Enter your name and a valid five-letter secret word.');
    setBusy(true); setError('');
    try {
      const { data, error } = await supabase.rpc('wh_create_room', { p_player_id: playerId, p_player_name: name.trim(), p_secret_word: secret.toUpperCase() });
      if (error) throw error;
      setRoomCode(data.room_code); setRole('host'); setGame(data); setScreen('game');
    } catch (e) { setProblem(e); } finally { setBusy(false); }
  }

  async function joinRoom() {
    if (!ready) return setError('Connect your Supabase project first. See README.md.');
    if (!name.trim() || !/^[A-Z0-9]{6}$/.test(roomCode.toUpperCase())) return setError('Enter your name and the six-character room code.');
    setBusy(true); setError('');
    try {
      const { data, error } = await supabase.rpc('wh_join_room', { p_player_id: playerId, p_player_name: name.trim(), p_room_code: roomCode.toUpperCase() });
      if (error) throw error;
      setRole('guesser'); setGame(data); setGuesses(data.guesses || []); setScreen('game');
    } catch (e) { setProblem(e); } finally { setBusy(false); }
  }

  async function refresh() {
    if (!supabase || !roomCode) return;
    const { data, error } = await supabase.rpc('wh_get_game', { p_player_id: playerId, p_room_code: roomCode });
    if (!error && data) { setGame(data); setGuesses(data.guesses || []); }
  }

  useEffect(() => {
    if (!game?.id || !supabase) return;
    const channel = supabase.channel(`room-${game.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'wh_guesses', filter: `room_id=eq.${game.id}` }, refresh).on('postgres_changes', { event: '*', schema: 'public', table: 'wh_rooms', filter: `id=eq.${game.id}` }, refresh).subscribe();
    const poll = setInterval(refresh, 4000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [game?.id, roomCode]);

  async function submitGuess() {
    const word = draft.toUpperCase();
    if (!/^[A-Z]{5}$/.test(word)) return setError('Your guess must contain exactly five letters.');
    setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('wh_submit_guess', { p_player_id: playerId, p_room_code: roomCode, p_word: word });
      if (error) throw error;
      setDraft(''); await refresh();
    } catch (e) { setProblem(e); } finally { setBusy(false); }
  }

  async function saveFeedback(guessId) {
    const marks = Array.from({ length: 5 }, (_, i) => feedback[`${guessId}-${i}`] || 'absent');
    setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('wh_mark_feedback', { p_player_id: playerId, p_room_code: roomCode, p_guess_id: guessId, p_marks: marks });
      if (error) throw error;
      setNotice('Feedback sent to the other player.'); setTimeout(() => setNotice(''), 2500); await refresh();
    } catch (e) { setProblem(e); } finally { setBusy(false); }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(roomCode); setNotice('Room code copied!'); setTimeout(() => setNotice(''), 2000); } catch { setNotice(`Share this code: ${roomCode}`); }
  }

  const status = game?.status || 'waiting';
  const attempts = guesses.length;
  const isOver = status === 'won' || status === 'lost';

  return <main className="shell">
    <header><div className="brand-mark">W</div><div><div className="brand">WORD HUNT</div><div className="tagline">Five letters. Five chances. One winner.</div></div></header>
    {!ready && <div className="setup-banner">Backend not connected yet — add your Supabase keys after following the README.</div>}
    {screen === 'home' && <section className="panel hero">
      <div className="eyebrow">THE TWO-PLAYER WORD CHALLENGE</div><h1>Can you crack<br/><em>the secret word?</em></h1><p className="muted">Challenge a friend online. One player sets the word, the other gets five attempts to find it.</p>
      <div className="feature-row"><span>▦ 5-letter word</span><span>◷ 5 attempts</span><span>◎ Live feedback</span></div>
      <button className="primary" onClick={() => {setScreen('create'); setError('');}}>Create a game <b>→</b></button>
      <button className="secondary" onClick={() => {setScreen('join'); setError('');}}>Join a game</button>
    </section>}
    {screen === 'create' && <section className="panel form-panel"><button className="back" onClick={() => setScreen('home')}>← Back</button><div className="eyebrow">PLAYER 1 · HOST</div><h2>Set the secret word</h2><p className="muted">Keep it to yourself. Your friend won't see it.</p><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Alex" maxLength="24"/><label>Secret five-letter word</label><input className="word-input" value={secret} onChange={e=>setSecret(e.target.value.replace(/[^a-z]/gi,'').slice(0,5).toUpperCase())} placeholder="_ _ _ _ _" maxLength="5"/><button className="primary" disabled={busy} onClick={createRoom}>{busy?'Creating…':'Create room →'}</button></section>}
    {screen === 'join' && <section className="panel form-panel"><button className="back" onClick={() => setScreen('home')}>← Back</button><div className="eyebrow">PLAYER 2 · GUESSER</div><h2>Join your friend's game</h2><p className="muted">Enter the room code shared by Player 1.</p><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sam" maxLength="24"/><label>Six-character room code</label><input className="code-input" value={roomCode} onChange={e=>setRoomCode(e.target.value.replace(/[^a-z0-9]/gi,'').slice(0,6).toUpperCase())} placeholder="ABC123" maxLength="6"/><button className="primary" disabled={busy} onClick={joinRoom}>{busy?'Joining…':'Join room →'}</button></section>}
    {screen === 'game' && game && <section className="panel game-panel">
      <div className="game-top"><div><div className="eyebrow">ROOM CODE</div><button className="room-code" onClick={copyCode}>{roomCode} ⧉</button></div><span className={`status ${status}`}>{status==='waiting'?'Waiting for player':status==='active'?'In progress':status==='won'?'Guesser won':'Host won'}</span></div>
      <div className="players"><div><small>PLAYER 1 · HOST</small><b>{game.host_name || 'Host'} {role==='host'?'(you)':''}</b></div><div><small>PLAYER 2 · GUESSER</small><b>{game.guesser_name || 'Waiting…'} {role==='guesser'?'(you)':''}</b></div></div>
      <div className="attempt-label"><b>GUESS GRID</b><span>{attempts} / 5 attempts</span></div>
      <div className="grid">{Array.from({length:5},(_,r)=>{const g=guesses[r]; return <div className="grid-row" key={r}>{Array.from({length:5},(_,c)=>{const letter=g?.word?.[c] || (r===attempts && role==='guesser' && !isOver ? draft[c] : ''); const mark=g?.marks?.[c]; return <div key={c} className={`tile ${mark?COLORS[mark]:letter?'filled':''}`}>{letter||''}</div>;})}</div>;})}</div>
      {status==='waiting' && <div className="waiting-note">Share the room code with Player 2. The game starts when they join.</div>}
      {status==='active' && role==='guesser' && <div className="guess-entry"><label>Your next guess</label>{guesses.length>0 && !guesses[guesses.length-1].marks && <div className="waiting-note">Waiting for Player 1 to mark your previous guess.</div>}<input className="word-input" autoComplete="off" value={draft} onChange={e=>setDraft(e.target.value.replace(/[^a-z]/gi,'').slice(0,5).toUpperCase())} placeholder="TYPE 5 LETTERS" maxLength="5"/><button className="primary" disabled={busy || attempts>=5 || (guesses.length>0 && !guesses[guesses.length-1].marks)} onClick={submitGuess}>Submit guess →</button></div>}
      {status==='active' && role==='host' && <div className="feedback-area"><h3>Mark the latest guess</h3><p className="muted">Tap each letter to cycle through the feedback colours, then send it.</p>{guesses.filter(g=>!g.marks).map(g=><div className="mark-card" key={g.id}><div className="mark-word">{g.word.split('').map((ch,i)=>{const key=`${g.id}-${i}`;const val=feedback[key]||'absent';return <button key={i} className={`tile mark-tile ${COLORS[val]}`} onClick={()=>setFeedback(old=>({...old,[key]:val==='absent'?'present':val==='present'?'correct':'absent'}))}>{ch}</button>;})}</div><div className="hint">Tap: grey → yellow → green</div><button className="primary" disabled={busy} onClick={()=>saveFeedback(g.id)}>Send feedback</button></div>)}{guesses.length===0&&<div className="waiting-note">Waiting for Player 2's first guess.</div>}</div>}
      {isOver && <div className="result"><div className="eyebrow">GAME OVER</div><h2>{status==='won'?'🎉 The word was guessed!':'🏆 Player 1 wins!'}</h2><p>{status==='won'?'Player 2 cracked the word.':'All five attempts have been used.'}</p>{role==='host'&&<p className="muted">Secret word: <b>{game.secret_word || 'Hidden'}</b></p>}<button className="secondary" onClick={()=>{setScreen('home');setGame(null);setGuesses([]);setRoomCode('');setRole('');}}>Back to home</button></div>}
      <button className="text-button" onClick={refresh}>↻ Refresh game</button>
    </section>}
    {error && <div className="error">{error}</div>}{notice && <div className="notice">{notice}</div>}
    <footer>WORD HUNT <span>·</span> THINK SMART. GUESS RIGHT.</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
