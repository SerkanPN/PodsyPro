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
      <div className="max-w-md w-full bg-[#111] p-8 rounded-3xl border border-[#222] shadow-2xl relative overflow-hidden text-center">
        {/* Decorative blur */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-orange-500/10 blur-[50px] -z-10 rounded-full"></div>
        
        <div className="mb-10">
          <h1 className="text-4xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-rose-400 mb-2">PodsyPro</h1>
          <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Akıllı Mağaza Yönetimi</p>
        </div>

        {error && <div className="text-rose-500 text-sm font-bold bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 mb-6">{error}</div>}

        <button 
          onClick={async () => {
            setLoading(true);
            try {
              const res = await fetch('https://api.podsy.pro/etsy/connect');
              const data = await res.json();
              if (data.auth_url) window.location.href = data.auth_url;
              else throw new Error("URL alınamadı");
            } catch (err) {
              setError("Etsy bağlantısı kurulamadı. Lütfen tekrar deneyin.");
              setLoading(false);
            }
          }}
          disabled={loading}
          className="w-full bg-[#F16521] text-white font-black py-4 rounded-xl hover:bg-[#D55315] hover:scale-105 active:scale-95 transition-all uppercase tracking-widest text-sm disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-orange-900/20"
        >
          {loading ? 'Yönlendiriliyor...' : 'Login with Etsy'}
        </button>
      </div>
    </div>
  );
};

export default LoginPage;
