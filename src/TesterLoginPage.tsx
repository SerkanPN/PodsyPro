import React, { useState } from 'react';
import { useAppContext } from './AppContext';

const TesterLoginPage: React.FC = () => {
  const { login, register } = useAppContext();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLoginMode) {
        await login(username, password);
      } else {
        await register(username, password);
        await login(username, password);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-zinc-100">
      <div className="max-w-md w-full bg-[#111] p-8 rounded-3xl border border-[#222] shadow-2xl relative overflow-hidden text-center">
        {/* Decorative blur */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-sky-500/10 blur-[50px] -z-10 rounded-full"></div>
        
        <div className="mb-10">
          <h1 className="text-4xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-indigo-400 mb-2">PodsyPro</h1>
          <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Admin Login (Tester)</p>
        </div>

        {error && <div className="text-rose-500 text-sm font-bold bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 mb-6">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input 
              type="text" 
              placeholder="Username" 
              className="w-full bg-[#1a1a1a] border border-[#333] px-4 py-3 rounded-xl text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <input 
              type="password" 
              placeholder="Password" 
              className="w-full bg-[#1a1a1a] border border-[#333] px-4 py-3 rounded-xl text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-sky-500 text-white font-black py-4 rounded-xl hover:bg-sky-400 hover:scale-105 active:scale-95 transition-all uppercase tracking-widest text-sm disabled:opacity-50 mt-4"
          >
            {loading ? 'Processing...' : (isLoginMode ? 'Login' : 'Sign Up')}
          </button>
        </form>

        <div className="mt-6 text-sm text-zinc-500">
          {isLoginMode ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button" 
            onClick={() => setIsLoginMode(!isLoginMode)}
            className="text-sky-400 font-bold hover:underline cursor-pointer"
          >
            {isLoginMode ? 'Sign Up' : 'Login'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TesterLoginPage;
