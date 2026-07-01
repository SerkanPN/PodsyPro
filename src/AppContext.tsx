import React, { createContext, useState, useCallback, useContext, ReactNode } from 'react';

// Context'te saklanacak verilerin ve fonksiyonların tip tanımı
interface AppContextType {
  favData: any[];
  historyData: any[];
  fetchFavorites: (type: string) => void;
  fetchHistory: (type: string) => void;
  toggleFollow: (type: string, id: string, e?: React.MouseEvent) => Promise<number | undefined>;
  HeartIcon: React.FC<{ isTracked: boolean }>;
  resolvePrice: (p: any) => number;
  currentUser: any;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => void;
  token: string | null;
}

// Başlangıç değerleriyle context'i oluşturma
const AppContext = createContext<AppContextType | undefined>(undefined);

// Diğer bileşenlerin context'e kolayca erişmesini sağlayacak özel bir hook
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

// Uygulamayı sarmalayacak olan Provider bileşeni
export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [favData, setFavData] = useState<any[]>([]);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState<any>(null);

  // When token changes, fetch user info
  React.useEffect(() => {
    if (token) {
      fetch('https://api.podsy.pro/api/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => {
        if (!res.ok) throw new Error('Invalid token');
        return res.json();
      })
      .then(user => setCurrentUser(user))
      .catch(() => {
        setToken(null);
        setCurrentUser(null);
        localStorage.removeItem('token');
      });
    } else {
      setCurrentUser(null);
    }
  }, [token]);

  const login = async (username: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    const res = await fetch('https://api.podsy.pro/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || 'Giriş başarısız');
    }
    const data = await res.json();
    setToken(data.access_token);
    localStorage.setItem('token', data.access_token);
  };

  const register = async (username: string, password: string) => {
    const res = await fetch('https://api.podsy.pro/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || 'Kayıt başarısız');
    }
  };

  const logout = () => {
    setToken(null);
    setCurrentUser(null);
    localStorage.removeItem('token');
  };

  const fetchFavorites = useCallback((type: string) => {
    fetch(`https://api.podsy.pro/favorites/${type}`)
      .then(r => r.json())
      .then(data => setFavData(data))
      .catch(err => console.error("Favoriler çekilemedi:", err));
  }, []);

  const fetchHistory = useCallback((type: string) => {
    fetch(`https://api.podsy.pro/history/${type}`)
      .then(r => r.json())
      .then(data => setHistoryData(data))
      .catch(err => console.error("Geçmiş çekilemedi:", err));
  }, []);

  const toggleFollow = useCallback(async (type: string, id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`https://api.podsy.pro/toggle-follow/${type}/${encodeURIComponent(id)}`, { method: 'POST' });
      const data = await res.json();
      
      // Favori listesini anında güncelle
      if (data.is_tracked === 0) {
        setFavData(prev => prev.filter(item => (item.listing_id || item.shop_id || item.keyword) !== id));
      }
      
      // Geçmiş listesini anında güncelle
      setHistoryData(prev => prev.map(item => {
        const itemId = item.listing_id || item.shop_id || item.keyword;
        if (itemId === id) return { ...item, is_tracked: data.is_tracked };
        return item;
      }));

      return data.is_tracked;
    } catch (err) { 
      alert("Takip işlemi başarısız.");
      return undefined;
    }
  }, [favData, historyData]);

  // Bu fonksiyonlar ve bileşenler artık context üzerinden sağlanacak
  const HeartIcon: React.FC<{ isTracked: boolean }> = ({ isTracked }) => {
    if (isTracked) {
      return (
        <svg className="w-6 h-6 text-rose-500 fill-rose-500 drop-shadow-md transition hover:scale-110" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      );
    }
    return (
      <svg className="w-6 h-6 text-white/60 hover:text-rose-500 drop-shadow-md transition hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
      </svg>
    );
  };
  
  const resolvePrice = (p: any): number => {
    if (typeof p === 'number') return p;
    if (p && typeof p === 'object' && p.amount !== undefined) return p.amount / (p.divisor || 100);
    if (typeof p === 'string') return parseFloat(p) || 0;
    return 0;
  };

  const value = { favData, historyData, fetchFavorites, fetchHistory, toggleFollow, HeartIcon, resolvePrice, currentUser, login, register, logout, token };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};