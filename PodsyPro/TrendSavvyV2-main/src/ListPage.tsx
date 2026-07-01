import React from 'react';
import { useAppContext } from './AppContext';

interface ListPageProps {
  title: string;
  items: any[];
  itemType: 'listing' | 'shop' | 'keyword';
  onItemClick: (type: 'listing' | 'shop' | 'search', id: string) => void;
}

const ListPage: React.FC<ListPageProps> = ({ title, items, itemType, onItemClick }) => {

  const { toggleFollow, HeartIcon, resolvePrice } = useAppContext();

  const renderItem = (item: any, index: number) => {
    switch (itemType) {
      case 'listing':
        return (
          <div key={index} className="bg-[#111] rounded-2xl border border-[#333] overflow-hidden hover:border-sky-500 transition group flex flex-col shadow-lg cursor-pointer relative" onClick={() => onItemClick('listing', item.listing_id)}>
            <div className="absolute top-2 left-2 z-10" onClick={(e) => toggleFollow('listing', item.listing_id, e)}><HeartIcon isTracked={item.is_tracked} /></div>
            <div className="relative aspect-square overflow-hidden bg-[#000]">
              {item.image_url ? <img src={item.image_url} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition duration-500 opacity-90 group-hover:opacity-100" /> : <div className="w-full h-full flex items-center justify-center text-zinc-800 text-xs font-mono">NO IMAGE</div>}
              <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-md px-2 py-1 rounded text-[10px] font-mono font-bold text-sky-400 border border-[#333]">{resolvePrice(item.price).toFixed(2)} {item.currency || 'USD'}</div>
            </div>
            <div className="p-4 flex flex-col flex-1 space-y-3">
              <h3 className="text-zinc-300 text-xs font-bold line-clamp-2 leading-snug group-hover:text-sky-400 transition">{item.title}</h3>
              <div className="mt-auto pt-3 flex items-center justify-between border-t border-[#222]">
                <span className="text-[10px] font-bold text-zinc-500 truncate max-w-[60%]">{item.shop_name || " "}</span>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-bold">
                    {item.views !== undefined && <span>👁 {item.views}</span>}
                    {item.num_favorers !== undefined && <span className="text-rose-500">❤️ {item.num_favorers}</span>}
                </div>
              </div>
            </div>
          </div>
        );
      case 'shop':
        return (
          <div key={index} className="bg-[#111] p-6 rounded-2xl border border-[#333] hover:border-sky-500 transition cursor-pointer flex flex-col items-center text-center shadow-lg relative group" onClick={() => onItemClick('shop', item.shop_id)}>
            <div className="absolute top-4 left-4 z-10" onClick={(e) => toggleFollow('shop', item.shop_id, e)}><HeartIcon isTracked={item.is_tracked} /></div>
            <img src={item.icon_url || 'https://via.placeholder.com/150'} className="w-20 h-20 rounded-xl border-2 border-[#222] mb-4 group-hover:scale-105 transition" alt="" />
            <h3 className="text-lg font-black text-white">{item.shop_name}</h3>
            <p className="text-[10px] text-zinc-500 mt-2 font-mono">ID: {item.shop_id}</p>
          </div>
        );
      case 'keyword':
        return (
          <div key={index} className="bg-[#111] p-6 rounded-2xl border border-[#333] hover:border-sky-500 transition cursor-pointer flex justify-between items-center shadow-lg group" onClick={() => onItemClick('search', item.keyword)}>
            <div>
              <h3 className="text-xl font-black text-white group-hover:text-sky-400 transition">"{item.keyword}"</h3>
              <p className="text-xs text-zinc-500 font-mono mt-1">Sonuç: {item.total_results?.toLocaleString()}</p>
            </div>
            <div onClick={(e) => toggleFollow('keyword', item.keyword, e)}><HeartIcon isTracked={item.is_tracked} /></div>
          </div>
        );
      default:
        return null;
    }
  };

  const gridClass = itemType === 'keyword' 
    ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" 
    : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-[fadeIn_0.3s]">
      <h2 className="text-4xl font-black tracking-tighter text-white italic uppercase border-b border-[#333] pb-4">{title}</h2>
      <div className={`grid ${gridClass} gap-4`}>
        {items.length > 0 
          ? items.map(renderItem) 
          : <p className="text-zinc-600 col-span-full text-center mt-10 font-bold">Burada gösterilecek bir şey yok.</p>
        }
      </div>
    </div>
  );
};

export default ListPage;