import React, { useState } from 'react';
import { useAppContext } from './AppContext';

const LoginPage: React.FC = () => {
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
        // After successful registration, login automatically
        await login(username, password);
      }
    } catch (err: any) {
      setError(err.message || 'Bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4 text-zinc-100">
      <div className="max-w-md w-full bg-[#111] p-8 rounded-3xl border border-[#222] shadow-2xl relative overflow-hidden">
        {/* Decorative blur */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-sky-500/10 blur-[50px] -z-10 rounded-full"></div>
        
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-emerald-400 mb-2">TrendSavvy</h1>
          <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Akıllı Mağaza Yönetimi</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Kullanıcı Adı</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black border border-zinc-800 text-white p-4 rounded-xl outline-none focus:border-sky-500 transition font-mono"
              placeholder="Kullanıcı Adınız"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Parola</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black border border-zinc-800 text-white p-4 rounded-xl outline-none focus:border-sky-500 transition font-mono"
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="text-rose-500 text-sm font-bold bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">{error}</div>}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-zinc-100 text-black font-black py-4 rounded-xl hover:bg-sky-500 hover:text-white transition uppercase tracking-widest text-sm disabled:opacity-50"
          >
            {loading ? 'Bekleyin...' : (isLoginMode ? 'Giriş Yap' : 'Kayıt Ol')}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button 
            onClick={() => { setIsLoginMode(!isLoginMode); setError(null); }}
            className="text-zinc-500 hover:text-sky-400 transition text-sm font-bold"
          >
            {isLoginMode ? 'Hesabınız yok mu? Kayıt Olun' : 'Zaten hesabınız var mı? Giriş Yapın'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
