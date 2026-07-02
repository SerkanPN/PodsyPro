import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { useAppContext } from './AppContext';

interface ComparePageProps {
  onListingClick?: (id: string) => void;
  onShopClick?: (id: string) => void;
}

const ComparePage: React.FC<ComparePageProps> = ({ onListingClick, onShopClick }) => {
  const { token } = useAppContext();
  const [type, setType] = useState<'listing' | 'shop'>('listing');
  const [id1, setId1] = useState('');
  const [id2, setId2] = useState('');
  const [data1, setData1] = useState<any>(null);
  const [data2, setData2] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);

  const handleCompare = async () => {
    if (!id1 || !id2) {
      setError("Lütfen her iki ID alanını da doldurun.");
      return;
    }
    setLoading(true);
    setError(null);
    setData1(null);
    setData2(null);

    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const res1 = await fetch(`https://api.podsy.pro/${type}/${id1}?force_refresh=false`, { headers });
      const res2 = await fetch(`https://api.podsy.pro/${type}/${id2}?force_refresh=false`, { headers });
      
      const json1 = await res1.json();
      const json2 = await res2.json();

      if (json1.ERROR) throw new Error(`Target 1 Error: ${json1.ERROR}`);
      if (json2.ERROR) throw new Error(`Target 2 Error: ${json2.ERROR}`);

      setData1(json1);
      setData2(json2);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (data1 && data2 && chartRef.current) {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }

      const history1 = type === 'listing' ? data1.history : data1.history; 
      const history2 = type === 'listing' ? data2.history : data2.history;

      // Group by day for Target 1
      const grouped1: any = {};
      if (history1) {
        history1.slice().reverse().forEach((d: any) => {
          if (d.capture_time) grouped1[d.capture_time.split('T')[0]] = d;
        });
      }
      const chartData1 = Object.values(grouped1);

      // Group by day for Target 2
      const grouped2: any = {};
      if (history2) {
        history2.slice().reverse().forEach((d: any) => {
          if (d.capture_time) grouped2[d.capture_time.split('T')[0]] = d;
        });
      }
      const chartData2 = Object.values(grouped2);

      // Extract all unique labels (dates)
      const allDates = Array.from(new Set([
        ...chartData1.map((d: any) => d.capture_time.split('T')[0]),
        ...chartData2.map((d: any) => d.capture_time.split('T')[0])
      ])).sort();

      // Map data to labels
      const mapToLabels = (data: any[], key: string) => {
        return allDates.map(date => {
          const found = data.find((d: any) => d.capture_time.split('T')[0] === date);
          return found ? found[key] : null;
        });
      };

      const yKey = type === 'listing' ? 'views' : 'transaction_sold_count';
      const labelName = type === 'listing' ? 'Görüntülenme' : 'Satış';

      const ctx = chartRef.current.getContext('2d');
      if (ctx) {
        chartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: allDates,
            datasets: [
              {
                label: `Hedef 1 ${labelName}`,
                data: mapToLabels(chartData1, yKey),
                borderColor: '#0ea5e9',
                backgroundColor: '#0ea5e915',
                fill: true,
                tension: 0.3
              },
              {
                label: `Hedef 2 ${labelName}`,
                data: mapToLabels(chartData2, yKey),
                borderColor: '#10b981', 
                backgroundColor: '#10b98115',
                fill: true,
                tension: 0.3
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: '#a1a1aa' } }
            },
            scales: {
              x: { ticks: { color: '#52525b' }, grid: { color: '#27272a' } },
              y: { ticks: { color: '#52525b' }, grid: { color: '#27272a' } }
            }
          }
        });
      }
    }
  }, [data1, data2, type]);

  const renderListingSummary = (data: any, title: string, color: string) => {
    const listing = data.listing || {};
    return (
      <div className={`bg-zinc-900 border border-${color}-900/50 p-6 rounded-2xl`}>
        <h3 className={`text-${color}-500 font-black mb-4 uppercase tracking-widest`}>{title}</h3>
        {listing.images && listing.images.length > 0 && (
          <img src={listing.images[0].url_570xN} alt="Listing" className="w-full h-48 object-cover rounded-xl mb-4 border border-zinc-800" />
        )}
        <h4 className="font-bold text-zinc-100 mb-2 truncate">{listing.title || 'Unknown Title'}</h4>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Fiyat</p>
            <p className={`font-mono font-bold text-${color}-400`}>{listing.price?.amount / (listing.price?.divisor || 1)} {listing.price?.currency_code}</p>
          </div>
          <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Görüntülenme</p>
            <p className="font-mono font-bold text-zinc-300">{listing.views}</p>
          </div>
          <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Favori</p>
            <p className="font-mono font-bold text-rose-400">❤️ {listing.num_favorers}</p>
          </div>
          <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Stok</p>
            <p className="font-mono font-bold text-zinc-300">{listing.quantity}</p>
          </div>
        </div>
      </div>
    );
  };

  const renderShopSummary = (data: any, title: string, color: string) => {
    const shop = data.shop || {};
    return (
      <div className={`bg-zinc-900 border border-${color}-900/50 p-6 rounded-2xl`}>
        <h3 className={`text-${color}-500 font-black mb-4 uppercase tracking-widest`}>{title}</h3>
        {shop.icon_url_fullxfull && (
          <img src={shop.icon_url_fullxfull} alt="Shop Icon" className="w-24 h-24 object-cover rounded-full mb-4 border-2 border-zinc-800 mx-auto" />
        )}
        <h4 className="font-bold text-zinc-100 mb-2 text-center text-xl">{shop.shop_name || 'Unknown Shop'}</h4>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Toplam Satış</p>
            <p className={`font-mono font-bold text-${color}-400 text-xl`}>{shop.transaction_sold_count}</p>
          </div>
          <div className="bg-black/50 p-3 rounded-lg border border-zinc-800 text-center">
            <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Aktif İlan</p>
            <p className="font-mono font-bold text-zinc-300 text-xl">{shop.listing_active_count}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-[fadeIn_0.3s]">
      <div className="bg-[#111] p-6 rounded-3xl border border-[#222] shadow-2xl">
        <h2 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter flex items-center gap-2">
          <svg className="w-6 h-6 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
          Benchmark & Kıyaslama
        </h2>
        
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Tip Seçimi</label>
            <select 
              value={type} 
              onChange={(e) => setType(e.target.value as 'listing' | 'shop')}
              className="w-full bg-black border border-zinc-800 text-white p-3 rounded-xl outline-none focus:border-sky-500 transition"
            >
              <option value="listing">Listing (Ürün)</option>
              <option value="shop">Shop (Mağaza)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-bold text-sky-500 uppercase tracking-widest mb-2 block">Hedef 1 ID</label>
            <input 
              type="text" 
              value={id1} 
              onChange={(e) => setId1(e.target.value)}
              placeholder="Örn: 123456789"
              className="w-full bg-black border border-sky-900/50 text-white p-3 rounded-xl outline-none focus:border-sky-500 transition"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-2 block">Hedef 2 ID</label>
            <input 
              type="text" 
              value={id2} 
              onChange={(e) => setId2(e.target.value)}
              placeholder="Örn: 987654321"
              className="w-full bg-black border border-emerald-900/50 text-white p-3 rounded-xl outline-none focus:border-emerald-500 transition"
            />
          </div>
          <button 
            onClick={handleCompare}
            disabled={loading}
            className="bg-zinc-100 text-black font-black px-8 py-3 rounded-xl hover:bg-sky-500 hover:text-white transition disabled:opacity-50 h-[50px]"
          >
            {loading ? 'KIYASLANIYOR...' : 'KIYASLA'}
          </button>
        </div>
        
        {error && <div className="mt-4 text-rose-500 text-sm font-bold bg-rose-950/30 p-3 rounded-lg border border-rose-900">{error}</div>}
      </div>

      {data1 && data2 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {type === 'listing' ? renderListingSummary(data1, "Hedef 1", "sky") : renderShopSummary(data1, "Hedef 1", "sky")}
            {type === 'listing' ? renderListingSummary(data2, "Hedef 2", "emerald") : renderShopSummary(data2, "Hedef 2", "emerald")}
          </div>

          <div className="bg-[#111] p-6 rounded-3xl border border-[#222] shadow-2xl">
            <h3 className="text-zinc-400 font-bold text-sm uppercase tracking-widest mb-6">Tarihsel İvme (Growth Chart)</h3>
            <div className="h-[400px]">
              <canvas ref={chartRef}></canvas>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ComparePage;
