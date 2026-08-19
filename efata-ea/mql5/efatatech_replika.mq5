//+------------------------------------------------------------------+
//|                                          efatatech_replika.mq5   |
//|  Replika EfataTech EA v26.07.29 — port dari replika Python       |
//|  tervalidasi (folder efata-ea/, repo Sinyal-saham-harian).       |
//|                                                                  |
//|  v1 — cakupan:                                                   |
//|   - Mesin inti: PINDAI > LAWAN > TEMAN > UPDATE > PENGAMAN >     |
//|     EXIT per magic, throttle 1 detik                             |
//|   - Teknik i=1,2,4,5,6,7 (pending BS/SS). i=3/8/9 belum (v2)     |
//|   - Mode martingale (xLot>1), pasangan (xLot=1), linier          |
//|   - Booster, teman -T/-TL, maxLevel/maxLevCut/minMarginLev,      |
//|     exitPct/exitUSD/exitRR/exitBid, lossMax, jam WIB             |
//|   - Remote: LS Kendali (magic 900000) + LS Param 29 slot         |
//|     (magic 55555). LS Loop & nextRound belum (v2)                |
//|   - Default input = preset P1 tervalidasi:                       |
//|     magics 10220+10330, xLot=3, exitPct=1, exitRR=0, exitUSD=0,  |
//|     maxLevCut=2, minMarginLev=500, lossMaxPersen=15, MM=0.3      |
//+------------------------------------------------------------------+
#property copyright "Replika riset - EfataTech EA"
#property version   "1.00"

#include <Trade/Trade.mqh>

//--- konstanta harga siaga & magic remote (sesuai dokumen)
#define BS_STANDBY      7777777.0
#define SS_STANDBY      0.07
#define MAGIC_KENDALI   900000
#define MAGIC_PARAM     55555
#define PRICE_KENDALI   900000000.0
#define PRICE_PARAM_0   100000.0   // slot n -> harga 100000+n
#define REM99           99.0

//=================== INPUT (default = preset P1) ====================
input string InpMagics        = "10220,10330"; // daftar magic imZEX, pisah koma
input double InpLot           = 0.0;    // lot awal per magic (0 = otomatis MM)
input bool   InpAutoSeed      = true;   // true = pasangan siaga otomatis (spt backtest)
input bool   InpUseRemote     = true;   // buat LS Kendali & LS Param

input group "=== LS Param slot 1-29 (nilai awal) ==="
input double InpExitPct       = 1.0;    // 1  tutup magic bila profit > X% balance
input double InpExitUSD       = 0.0;    // 2  tutup semua bila profit > USD (0=off)
input double InpXLot          = 3.0;    // 3  pengali lot lawan (1 = mode pasangan)
input double InpLossMaxUSD    = 0.0;    // 4  tutup magic bila rugi > USD (0=off)
input double InpLossMaxPersen = 15.0;   // 5  tutup magic bila rugi > X% balance
input double InpMinMarginLev  = 500.0;  // 6  margin level < ini -> pending diparkir
input double InpXLotLinier    = 0.0;    // 7  >0 = lot linier init*(level+1)*nilai
input double InpUseRSI        = 0.0;    // 8  filter RSI L0 (0=off, 1-7=digit TF)
input double InpExitRR        = 0.0;    // 9  X.Y tutup bila profit > RR x rugi terburuk
input double InpExitBid       = 0.0;    // 10 Bid > nilai -> close all (0=off)
input double InpExitBidMin    = 0.0;    // 11 Bid < nilai -> close all (0=off)
input double InpLoopPerDay    = 0.0;    // 12 (v2 - belum dipakai)
input double InpStartTrade    = 0.0;    // 13 jam mulai WIB
input double InpEndTrade      = 24.0;   // 14 jam akhir WIB (24 = 24/7)
input double InpWibOffset     = 7.0;    // 15 offset jam broker -> WIB
input double InpTR            = 1.0;    // 16 1=geser lawan tiap detik, 0=isi 1x
input double InpMM            = 0.3;    // 17 lot per 100k balance (bila lot=0)
input double InpUseDivergent  = 0.0;    // 18 (v2 - belum dipakai)
input double InpNextRound     = 0.0;    // 19 (v2 - belum dipakai)
input double InpUseEMA        = 0.0;    // 20 >0 = period EMA filter target
input double InpAddTemen      = 2.0;    // 21 maks order teman -T
input double InpMaxLevel      = 0.0;    // 22 batas level (0=off)
input double InpMaxLevCut     = 2.0;    // 23 level cut (0=off)
input double InpAtrBuf        = 0.4;    // 24 [i=6] buffer ATR
input double InpMinADX        = 20.0;   // 25 [i=6] gerbang ADX
input double InpBooster1      = 0.0;    // 26 X.Y booster level
input double InpBooster2      = 0.0;    // 27
input double InpBooster3      = 0.0;    // 28
input double InpLotTeman      = 0.0;    // 29 pengali lot -T (0 = samakan)

//=================== PARAMETER RUNTIME (live-edit) ==================
double P[30];  // indeks 1..29 = slot LS Param

void ParamDefaults()
  {
   P[1]=InpExitPct;    P[2]=InpExitUSD;    P[3]=InpXLot;
   P[4]=InpLossMaxUSD; P[5]=InpLossMaxPersen; P[6]=InpMinMarginLev;
   P[7]=InpXLotLinier; P[8]=InpUseRSI;     P[9]=InpExitRR;
   P[10]=InpExitBid;   P[11]=InpExitBidMin; P[12]=InpLoopPerDay;
   P[13]=InpStartTrade; P[14]=InpEndTrade;  P[15]=InpWibOffset;
   P[16]=InpTR;        P[17]=InpMM;        P[18]=InpUseDivergent;
   P[19]=InpNextRound; P[20]=InpUseEMA;    P[21]=InpAddTemen;
   P[22]=InpMaxLevel;  P[23]=InpMaxLevCut; P[24]=InpAtrBuf;
   P[25]=InpMinADX;    P[26]=InpBooster1;  P[27]=InpBooster2;
   P[28]=InpBooster3;  P[29]=InpLotTeman;
  }

//=================== STATE PER MAGIC ================================
int      g_magic[];        // magic imZEX aktif
double   g_initLot[];      // lot awal per magic
double   g_worst[];        // floating paling negatif siklus berjalan
int      g_temanN[];       // jumlah teman -T siklus ini
datetime g_frUp[];         // waktu fraktal atas terakhir yang dipakai
datetime g_frDn[];         // waktu fraktal bawah terakhir yang dipakai
datetime g_lastClose[];    // waktu TutupMagic terakhir
bool     g_lvlParked[];    // pending diparkir oleh maxLevel

bool     g_marginLow=false; // rem minMarginLev sedang aktif
datetime g_lastCycle=0;

CTrade   trade;

//=================== UTIL DASAR =====================================
double Pt()          { return SymbolInfoDouble(_Symbol,SYMBOL_POINT); }
double Bid()         { return SymbolInfoDouble(_Symbol,SYMBOL_BID); }
double Ask()         { return SymbolInfoDouble(_Symbol,SYMBOL_ASK); }
double StopsDist()   { return (double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*Pt(); }

double NormLot(double v)
  {
   double vmin =SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double vmax =SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double vstep=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(vstep<=0) vstep=0.01;
   double steps=MathFloor(v/vstep+1e-9);
   double lot  =steps*vstep;
   if(lot<vmin) lot=vmin;
   if(lot>vmax) lot=vmax;
   return NormalizeDouble(lot,8);
  }

double AutoLot()
  {
   // dokumen 2b: lot otomatis = balance * MM / 100.000
   return NormLot(AccountInfoDouble(ACCOUNT_BALANCE)*P[17]/100000.0);
  }

ENUM_TIMEFRAMES TFFromDigit(int d)
  {
   switch(d)
     {
      case 1: return PERIOD_M1;
      case 2: return PERIOD_M5;
      case 3: return PERIOD_M30;
      case 4: return PERIOD_H4;
      case 5: return PERIOD_D1;
      case 6: return PERIOD_W1;
      case 7: return PERIOD_MN1;
     }
   return PERIOD_M1;
  }

// pecah magic imZEX
void DecodeMagic(int magic,int &i,int &m,int &z,int &e,int &x)
  {
   i=magic/10000; m=(magic/1000)%10; z=(magic/100)%10;
   e=(magic/10)%10; x=magic%10;
  }

bool HoursOK()
  {
   if(P[14]>=24 && P[13]<=0) return true;
   MqlDateTime dt; TimeToStruct(TimeCurrent(),dt);
   int wib=(int)MathMod(dt.hour+(int)P[15],24);
   int s=(int)P[13], e=(int)P[14];
   if(e>=24) return wib>=s;
   if(s<=e)  return (wib>=s && wib<e);
   return (wib>=s || wib<e);
  }

double SplitX(double v)  { return MathFloor(v); }
double SplitY(double v)  { return v-MathFloor(v); }

double BoosterMult(int level)
  {
   // boosterN = X.Y -> di level X lot dikali (1 + 0.Y). Contoh 3.35 -> 1.35
   double b[3]; b[0]=P[26]; b[1]=P[27]; b[2]=P[28];
   for(int k=0;k<3;k++)
      if(b[k]>0 && (int)SplitX(b[k])==level)
         return 1.0+SplitY(b[k]);
   return 1.0;
  }

//=================== HANDLE INDIKATOR PER TF ========================
int hMACD[8],hFract[8],hATR[8],hADX[8],hRSI[8];

bool EnsureHandles(int tfd)
  {
   if(tfd<1 || tfd>7) return false;
   ENUM_TIMEFRAMES tf=TFFromDigit(tfd);
   if(hMACD[tfd]==0 || hMACD[tfd]==INVALID_HANDLE)
     {
      hMACD[tfd] =iMACD(_Symbol,tf,5,13,1,PRICE_WEIGHTED);
      hFract[tfd]=iFractals(_Symbol,tf);
      hATR[tfd]  =iATR(_Symbol,tf,20);
      hADX[tfd]  =iADX(_Symbol,tf,14);
      hRSI[tfd]  =iRSI(_Symbol,tf,14,PRICE_CLOSE);
     }
   return (hMACD[tfd]!=INVALID_HANDLE);
  }

// nilai MACD bar ke-shift (0 = bar berjalan)
bool MacdVal(int tfd,int shift,double &out)
  {
   double b[];
   ArraySetAsSeries(b,true);
   if(CopyBuffer(hMACD[tfd],0,shift,1,b)<1) return false;
   out=b[0];
   return true;
  }

bool MacdAtas(int tfd)
  {
   double m0,m1,m2;
   if(!MacdVal(tfd,0,m0)||!MacdVal(tfd,1,m1)||!MacdVal(tfd,2,m2)) return false;
   return (m0>0 && m1>0 && m2>0);
  }

bool MacdBawah(int tfd)
  {
   double m0,m1,m2;
   if(!MacdVal(tfd,0,m0)||!MacdVal(tfd,1,m1)||!MacdVal(tfd,2,m2)) return false;
   return (m0<0 && m1<0 && m2<0);
  }

// ekstrem zona MACD searah dalam bar 1..53 (dokumen: lookback 53)
// up=true: zona MACD>0, target = high tertinggi zona
// needFr : minimal jumlah fraktal searah di dalam zona (0 = tanpa syarat)
// fallback: mundur ke zona lebih lama bila zona terbaru tak valid
double ZoneTarget(int tfd,bool up,int needFr,bool fallback)
  {
   const int LOOK=53;
   double macd[],hi[],lo[],fu[],fd[];
   ArraySetAsSeries(macd,true); ArraySetAsSeries(hi,true);
   ArraySetAsSeries(lo,true);   ArraySetAsSeries(fu,true);
   ArraySetAsSeries(fd,true);
   ENUM_TIMEFRAMES tf=TFFromDigit(tfd);
   if(CopyBuffer(hMACD[tfd],0,1,LOOK,macd)<LOOK) return 0;
   if(CopyHigh(_Symbol,tf,1,LOOK,hi)<LOOK)       return 0;
   if(CopyLow(_Symbol,tf,1,LOOK,lo)<LOOK)        return 0;
   if(needFr>0)
     {
      if(CopyBuffer(hFract[tfd],0,1,LOOK,fu)<LOOK) return 0;
      if(CopyBuffer(hFract[tfd],1,1,LOOK,fd)<LOOK) return 0;
     }
   int k=0;
   while(k<LOOK)
     {
      bool in=(up? macd[k]>0 : macd[k]<0);
      if(!in) { k++; continue; }
      int a=k;
      while(k<LOOK && (up? macd[k]>0 : macd[k]<0)) k++;
      int b=k-1;                        // zona = indeks a..b (bars-ago a+1..b+1)
      bool ok=(b-a+1)>=3;
      if(ok && needFr>0)
        {
         int nfr=0;
         for(int j=a;j<=b;j++)
           {
            double v=(up? fu[j] : fd[j]);
            if(v!=EMPTY_VALUE && v>0) nfr++;
           }
         ok=(nfr>=needFr);
        }
      if(ok)
        {
         double ext=(up? hi[a] : lo[a]);
         for(int j=a;j<=b;j++)
            ext=(up? MathMax(ext,hi[j]) : MathMin(ext,lo[j]));
         return ext;
        }
      if(!fallback) return 0;
     }
   return 0;
  }

double AtrVal(int tfd)
  {
   double b[]; ArraySetAsSeries(b,true);
   if(CopyBuffer(hATR[tfd],0,1,1,b)<1) return 0;
   return b[0];
  }

double AdxVal(int tfd)
  {
   double b[]; ArraySetAsSeries(b,true);
   if(CopyBuffer(hADX[tfd],0,1,1,b)<1) return -1;
   return b[0];
  }

double RsiVal(int tfd)
  {
   double b[]; ArraySetAsSeries(b,true);
   if(CopyBuffer(hRSI[tfd],0,1,1,b)<1) return -1;
   return b[0];
  }

double EmaClose(int tfd,int period)
  {
   static int hEMA=INVALID_HANDLE; static int lastTfd=-1; static int lastPer=-1;
   if(hEMA==INVALID_HANDLE || lastTfd!=tfd || lastPer!=period)
     {
      hEMA=iMA(_Symbol,TFFromDigit(tfd),period,0,MODE_EMA,PRICE_CLOSE);
      lastTfd=tfd; lastPer=period;
     }
   double b[]; ArraySetAsSeries(b,true);
   if(CopyBuffer(hEMA,0,1,1,b)<1) return 0;
   return b[0];
  }

// waktu fraktal terkonfirmasi terbaru (mulai bar 3)
datetime LastFractalTime(int tfd,bool upper)
  {
   double f[]; ArraySetAsSeries(f,true);
   const int LOOK=100;
   if(CopyBuffer(hFract[tfd],(upper?0:1),3,LOOK,f)<LOOK) return 0;
   ENUM_TIMEFRAMES tf=TFFromDigit(tfd);
   for(int k=0;k<LOOK;k++)
      if(f[k]!=EMPTY_VALUE && f[k]>0)
         return iTime(_Symbol,tf,k+3);
   return 0;
  }

// i=7: sideways = range 20 bar < 3*ATR DAN ADX bar1 < gate
bool IsSideways(int tfd,double adxGate)
  {
   double hi[],lo[];
   ArraySetAsSeries(hi,true); ArraySetAsSeries(lo,true);
   ENUM_TIMEFRAMES tf=TFFromDigit(tfd);
   if(CopyHigh(_Symbol,tf,1,20,hi)<20) return false;
   if(CopyLow(_Symbol,tf,1,20,lo)<20)  return false;
   double hh=hi[ArrayMaximum(hi)], ll=lo[ArrayMinimum(lo)];
   double atr=AtrVal(tfd), adx=AdxVal(tfd);
   if(atr<=0 || adx<0) return false;     // data gagal -> BUKAN sideways
   return ((hh-ll)<3.0*atr && adx<adxGate);
  }

//=================== SNAPSHOT POSISI & PENDING ======================
double MaxLotDir(int magic,int dir)    // dir +1 buy, -1 sell (semua posisi magic)
  {
   double mx=0;
   for(int k=PositionsTotal()-1;k>=0;k--)
     {
      ulong t=PositionGetTicket(k);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
      long pt=PositionGetInteger(POSITION_TYPE);
      if((dir>0 && pt==POSITION_TYPE_BUY)||(dir<0 && pt==POSITION_TYPE_SELL))
         mx=MathMax(mx,PositionGetDouble(POSITION_VOLUME));
     }
   return mx;
  }

int CountPos(int magic,int dir)
  {
   int n=0;
   for(int k=PositionsTotal()-1;k>=0;k--)
     {
      ulong t=PositionGetTicket(k);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
      long pt=PositionGetInteger(POSITION_TYPE);
      if(dir==0 ||
         (dir>0 && pt==POSITION_TYPE_BUY)||(dir<0 && pt==POSITION_TYPE_SELL)) n++;
     }
   return n;
  }

double SumLotDir(int magic,int dir)
  {
   double s=0;
   for(int k=PositionsTotal()-1;k>=0;k--)
     {
      ulong t=PositionGetTicket(k);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
      long pt=PositionGetInteger(POSITION_TYPE);
      if((dir>0 && pt==POSITION_TYPE_BUY)||(dir<0 && pt==POSITION_TYPE_SELL))
         s+=PositionGetDouble(POSITION_VOLUME);
     }
   return s;
  }

double FloatingMagic(int magic)        // profit + swap semua posisi magic
  {
   double s=0;
   for(int k=PositionsTotal()-1;k>=0;k--)
     {
      ulong t=PositionGetTicket(k);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if(magic>=0 && (int)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
      s+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
     }
   return s;
  }

// kumpulkan ticket pending magic per tipe. tlOnly: -1 tanpa -TL, 1 hanya -TL, 0 semua
int PendTickets(int magic,ENUM_ORDER_TYPE otype,int tlOnly,ulong &out[])
  {
   ArrayResize(out,0);
   for(int k=OrdersTotal()-1;k>=0;k--)
     {
      ulong t=OrderGetTicket(k);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)!=magic) continue;
      if((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE)!=otype) continue;
      bool isTL=(StringFind(OrderGetString(ORDER_COMMENT),"-TL")>=0);
      if(tlOnly<0 && isTL)  continue;
      if(tlOnly>0 && !isTL) continue;
      int n=ArraySize(out); ArrayResize(out,n+1); out[n]=t;
     }
   return ArraySize(out);
  }

bool PendingParked(ulong ticket)       // rem 99 manual: SL order == 99
  {
   if(!OrderSelect(ticket)) return true;
   return (MathAbs(OrderGetDouble(ORDER_SL)-REM99)<0.001);
  }

//=================== OPERASI ORDER ==================================
bool PlacePending(int magic,bool bs,double lot,double price,string comment,
                  bool enforceStops=true)
  {
   if(enforceStops)
     {
      if(bs  && price<Ask()+StopsDist()) return false;
      if(!bs && price>Bid()-StopsDist()) return false;
     }
   trade.SetExpertMagicNumber(magic);
   price=NormalizeDouble(price,_Digits);
   if(bs)  return trade.BuyStop(NormLot(lot),price,_Symbol,0,0,ORDER_TIME_GTC,0,comment);
   return trade.SellStop(NormLot(lot),price,_Symbol,0,0,ORDER_TIME_GTC,0,comment);
  }

bool MovePending(ulong ticket,double price)
  {
   if(!OrderSelect(ticket)) return false;
   ENUM_ORDER_TYPE ot=(ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
   price=NormalizeDouble(price,_Digits);
   if(ot==ORDER_TYPE_BUY_STOP  && price<Ask()+StopsDist()) return false;
   if(ot==ORDER_TYPE_SELL_STOP && price>Bid()-StopsDist()) return false;
   if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN)-price)<Pt()/2) return true;
   return trade.OrderModify(ticket,price,OrderGetDouble(ORDER_SL),
                            OrderGetDouble(ORDER_TP),ORDER_TIME_GTC,0,0);
  }

bool MarketOrder(int magic,int dir,double lot,string comment="")
  {
   trade.SetExpertMagicNumber(magic);
   if(dir>0) return trade.Buy(NormLot(lot),_Symbol,0,0,0,comment);
   return trade.Sell(NormLot(lot),_Symbol,0,0,0,comment);
  }

void DeletePendingsMagic(int magic)
  {
   for(int k=OrdersTotal()-1;k>=0;k--)
     {
      ulong t=OrderGetTicket(k);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)!=magic) continue;
      trade.OrderDelete(t);
     }
  }

// TutupMagic: close-by per pasangan (hemat spread), sisa close biasa
void TutupMagic(int idx)
  {
   int magic=g_magic[idx];
   for(int guard=0; guard<200; guard++)
     {
      ulong buyT=0,sellT=0; double buyL=-1,sellL=-1;
      for(int k=PositionsTotal()-1;k>=0;k--)
        {
         ulong t=PositionGetTicket(k);
         if(t==0) continue;
         if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
         if((int)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
         double vol=PositionGetDouble(POSITION_VOLUME);
         if(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY)
           { if(vol>buyL) { buyL=vol; buyT=t; } }
         else
           { if(vol>sellL){ sellL=vol; sellT=t; } }
        }
      if(buyT==0 || sellT==0) break;
      trade.SetExpertMagicNumber(magic);
      if(!trade.PositionCloseBy(buyT,sellT))
        {
         // fallback (mis. akun netting / broker menolak close-by)
         trade.PositionClose(buyT);
         trade.PositionClose(sellT);
        }
     }
   for(int k=PositionsTotal()-1;k>=0;k--)
     {
      ulong t=PositionGetTicket(k);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      if((int)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
      trade.PositionClose(t);
     }
   DeletePendingsMagic(magic);
   g_worst[idx]=0; g_temanN[idx]=0; g_lvlParked[idx]=false;
   g_lastClose[idx]=TimeCurrent();
  }

//=================== LOT TANGGA ====================================
double LadderLot(int idx,int level)
  {
   double init=g_initLot[idx], base;
   if(P[7]>0)          base=init*(level+1)*P[7];         // linier
   else if(P[3]>1.0)   base=init*MathPow(P[3],level);    // martingale
   else                base=init;                        // pasangan
   return NormLot(base*BoosterMult(level));
  }

int LevelFromLot(int idx,double lot)
  {
   double init=g_initLot[idx];
   if(lot<=0 || init<=0) return 0;
   if(P[7]>0)  return (int)MathMax(0,MathRound(lot/(init*P[7]))-1);
   if(P[3]>1.0) return (int)MathMax(0,MathRound(MathLog(lot/init)/MathLog(P[3])));
   return 0;
  }

bool EqualLotMode(int i,int z,int e)
  {
   // i=4 selalu lot-sama; ModePasangan aktif bila xLot=1, linier=0, Z<=E
   if(i==4) return true;
   return (MathAbs(P[3]-1.0)<0.001 && P[7]==0 && z<=e);
  }

//=================== TEKNIK: TARGET BS/SS ==========================
// return: harga target (0 = jangan geser). awayOnly diisi bila target
// hanya boleh menjauh. cut diisi true bila i=7 minta potong sideways.
void TechniqueTargets(int i,int tfd,int level,
                      double &tgtBS,double &tgtSS,
                      bool &awayBS,bool &awaySS,bool &cut,
                      bool &convBS,bool &convSS)
  {
   tgtBS=0; tgtSS=0; awayBS=false; awaySS=false; cut=false;
   convBS=false; convSS=false;

   bool bawah=MacdBawah(tfd), atas=MacdAtas(tfd);

   if(i==4)   // lot-sama: ekstrem 3 bar, selalu digeser tanpa gate MACD
     {
      double hi[],lo[];
      ArraySetAsSeries(hi,true); ArraySetAsSeries(lo,true);
      ENUM_TIMEFRAMES tf=TFFromDigit(tfd);
      if(CopyHigh(_Symbol,tf,1,3,hi)==3) tgtBS=hi[ArrayMaximum(hi)];
      if(CopyLow(_Symbol,tf,1,3,lo)==3)  tgtSS=lo[ArrayMinimum(lo)];
      return;
     }

   int  needFr =(i==2 || i==6)? 2:0;
   bool fallback=(i==2 || i==6);
   if(bawah) tgtBS=ZoneTarget(tfd,true,needFr,fallback);
   if(atas)  tgtSS=ZoneTarget(tfd,false,needFr,fallback);

   if(i==5)   // konversi cross: MACD bar2<0 & bar1>0 -> BS jadi market
     {
      double m1,m2;
      if(MacdVal(tfd,1,m1) && MacdVal(tfd,2,m2))
        {
         if(m2<0 && m1>0) convBS=true;
         if(m2>0 && m1<0) convSS=true;
        }
     }

   if(i==6)   // buffer ATR (atrBuf+0.15*level)*ATR + gerbang ADX
     {
      double atr=AtrVal(tfd);
      if(P[24]>0 && atr>0)
        {
         double buf=(P[24]+0.15*level)*atr;
         if(tgtBS>0) tgtBS+=buf;
         if(tgtSS>0) tgtSS=MathMax(Pt(),tgtSS-buf);
        }
      double adx=AdxVal(tfd);
      if(P[25]>0 && adx>=0 && adx<P[25]) { awayBS=true; awaySS=true; }
     }

   if(i==7)   // chop-guard: potong tangga level>=2, dorong target keluar range
     {
      double gate=(P[25]>0? P[25]:20.0);
      if(IsSideways(tfd,gate))
        {
         if(level>=2) { cut=true; return; }
         double hi[],lo[];
         ArraySetAsSeries(hi,true); ArraySetAsSeries(lo,true);
         ENUM_TIMEFRAMES tf=TFFromDigit(tfd);
         if(CopyHigh(_Symbol,tf,1,20,hi)==20 && CopyLow(_Symbol,tf,1,20,lo)==20)
           {
            double atr=AtrVal(tfd);
            double floorBS=hi[ArrayMaximum(hi)]+0.5*atr;
            double capSS  =lo[ArrayMinimum(lo)]-0.5*atr;
            tgtBS=(tgtBS>0? MathMax(tgtBS,floorBS):floorBS);
            tgtSS=(tgtSS>0? MathMin(tgtSS,capSS):capSS);
            awayBS=true; awaySS=true;
           }
        }
     }
  }

//=================== LANGKAH PER MAGIC ==============================
void SeedPair(int magic,double lot)
  {
   PlacePending(magic,true ,lot,BS_STANDBY,"",false);
   PlacePending(magic,false,lot,SS_STANDBY,"",false);
  }

void LawanMarti(int idx,int level,double maxBuy,double maxSell)
  {
   int magic=g_magic[idx];
   ulong bs[],ss[];
   PendTickets(magic,ORDER_TYPE_BUY_STOP ,-1,bs);
   PendTickets(magic,ORDER_TYPE_SELL_STOP,-1,ss);
   if(maxBuy>maxSell)
     {
      double lawan=(P[3]>1.0? LadderLot(idx,level+1)
                            : NormLot(maxBuy*MathMax(P[3],1.0)));
      for(int k=0;k<ArraySize(bs);k++) trade.OrderDelete(bs[k]);
      for(int k=0;k<ArraySize(ss);k++)
        {
         if(!OrderSelect(ss[k])) continue;
         if(OrderGetDouble(ORDER_VOLUME_CURRENT)<lawan-1e-9)
            trade.OrderDelete(ss[k]);
        }
      ulong left[];
      if(PendTickets(magic,ORDER_TYPE_SELL_STOP,-1,left)==0)
         PlacePending(magic,false,lawan,SS_STANDBY,"",false);
     }
   else if(maxSell>maxBuy)
     {
      double lawan=(P[3]>1.0? LadderLot(idx,level+1)
                            : NormLot(maxSell*MathMax(P[3],1.0)));
      for(int k=0;k<ArraySize(ss);k++) trade.OrderDelete(ss[k]);
      for(int k=0;k<ArraySize(bs);k++)
        {
         if(!OrderSelect(bs[k])) continue;
         if(OrderGetDouble(ORDER_VOLUME_CURRENT)<lawan-1e-9)
            trade.OrderDelete(bs[k]);
        }
      ulong left[];
      if(PendTickets(magic,ORDER_TYPE_BUY_STOP,-1,left)==0)
         PlacePending(magic,true,lawan,BS_STANDBY,"",false);
     }
   // terkunci 1:1 -> DIAM (anti loop hapus-buat)
  }

void LawanPasangan(int idx,int techI,int level)
  {
   int magic=g_magic[idx];
   if(P[22]>0 && level>=(int)P[22]) return;      // maxLevel: ladder berhenti
   double want;
   if(techI==4)
     {
      want=MathMax(MaxLotDir(magic,1),MaxLotDir(magic,-1));
      if(want<=0) want=g_initLot[idx];
     }
   else want=g_initLot[idx];                     // pasangan: lot awal
   want=NormLot(want);
   for(int side=0;side<2;side++)
     {
      ENUM_ORDER_TYPE ot=(side==0? ORDER_TYPE_BUY_STOP:ORDER_TYPE_SELL_STOP);
      ulong tk[];
      PendTickets(magic,ot,-1,tk);
      bool keep=false;
      for(int k=0;k<ArraySize(tk);k++)
        {
         if(!OrderSelect(tk[k])) continue;
         if(!keep && MathAbs(OrderGetDouble(ORDER_VOLUME_CURRENT)-want)<1e-9)
            keep=true;
         else
            trade.OrderDelete(tk[k]);
        }
      if(!keep)
         PlacePending(magic,(side==0),want,(side==0? BS_STANDBY:SS_STANDBY),"",false);
     }
  }

void Teman(int idx,int tfd,double maxBuy,double maxSell)
  {
   if(P[21]<=0) return;
   int magic=g_magic[idx];
   if(CountPos(magic,0)==0) return;
   double m1;
   if(!MacdVal(tfd,1,m1)) return;
   int dominant=(maxBuy>maxSell? 1 : (maxSell>maxBuy? -1:0));

   for(int dir=1;dir>=-1;dir-=2)
     {
      // buy teman lahir di lembah baru saat MACD atas; sell mirror
      if(dir>0 && m1<=0) continue;
      if(dir<0 && m1>=0) continue;
      if(dominant!=dir)  continue;   // v1: mode marti (teman searah dominan)
      if(g_temanN[idx]>=(int)P[21]) continue;
      datetime ft=LastFractalTime(tfd,(dir<0));  // buy <- fraktal bawah
      if(ft==0) continue;
      datetime last=(dir>0? g_frDn[idx]:g_frUp[idx]);
      if(last==0)   // init: catat dulu, jangan langsung tembak
        {
         if(dir>0) g_frDn[idx]=ft; else g_frUp[idx]=ft;
         continue;
        }
      if(ft==last) continue;
      if(dir>0) g_frDn[idx]=ft; else g_frUp[idx]=ft;
      g_temanN[idx]++;
      double lot=g_initLot[idx];
      if(P[29]>0) lot=g_initLot[idx]*MathPow(P[29],g_temanN[idx]);
      lot=NormLot(lot);
      MarketOrder(magic,dir,lot,"-T");
      // pelindung -TL 1:1 di seberang, ikut digeser rutin UPDATE
      PlacePending(magic,(dir<0),lot,(dir<0? BS_STANDBY:SS_STANDBY),"-TL",false);
     }
  }

// return true bila magic DITUTUP oleh cut teknik (i=7)
bool ApplyTargets(int idx,int techI,int tfd,int level,
                  double maxBuy,double maxSell,int nBuys,int nSells,
                  bool equalMode)
  {
   int magic=g_magic[idx];
   double tgtBS,tgtSS; bool awayBS,awaySS,cut,convBS,convSS;
   TechniqueTargets(techI,tfd,level,tgtBS,tgtSS,awayBS,awaySS,cut,convBS,convSS);

   if(cut) { TutupMagic(idx); return true; }

   ulong bs[],ss[];
   PendTickets(magic,ORDER_TYPE_BUY_STOP ,0,bs);
   PendTickets(magic,ORDER_TYPE_SELL_STOP,0,ss);

   if(convBS)     // i=5: semua BS -> buy market
     {
      for(int k=0;k<ArraySize(bs);k++)
        {
         if(!OrderSelect(bs[k])) continue;
         if(PendingParked(bs[k])) continue;
         double lot=OrderGetDouble(ORDER_VOLUME_CURRENT);
         string cm=OrderGetString(ORDER_COMMENT);
         trade.OrderDelete(bs[k]);
         MarketOrder(magic,1,lot,cm);
        }
      return false;
     }
   if(convSS)
     {
      for(int k=0;k<ArraySize(ss);k++)
        {
         if(!OrderSelect(ss[k])) continue;
         if(PendingParked(ss[k])) continue;
         double lot=OrderGetDouble(ORDER_VOLUME_CURRENT);
         string cm=OrderGetString(ORDER_COMMENT);
         trade.OrderDelete(ss[k]);
         MarketOrder(magic,-1,lot,cm);
        }
      return false;
     }

   if(!HoursOK()) return false;
   if(g_marginLow || g_lvlParked[idx]) return false;   // pending diparkir

   bool movableBS=equalMode || (nBuys==0)  || (maxSell>maxBuy);
   bool movableSS=equalMode || (nSells==0) || (maxBuy>maxSell);

   // gate RSI L0 (asumsi terdokumentasi: BS bila RSI<70, SS bila RSI>30)
   bool rsiBS=true, rsiSS=true;
   if(P[8]>0 && nBuys==0 && nSells==0)
     {
      int rtf=(int)P[8];
      if(rtf>=1 && rtf<=7 && EnsureHandles(rtf))
        {
         double r=RsiVal(rtf);
         if(r>=0) { rsiBS=(r<70.0); rsiSS=(r>30.0); }
        }
     }
   double ema=0;
   if(P[20]>0) ema=EmaClose(tfd,(int)P[20]);

   if(tgtBS>0 && movableBS && rsiBS)
      for(int k=0;k<ArraySize(bs);k++)
        {
         if(!OrderSelect(bs[k])) continue;
         if(PendingParked(bs[k])) continue;
         double cur=OrderGetDouble(ORDER_PRICE_OPEN);
         if(ema>0 && tgtBS<=ema) continue;
         if(awayBS && cur<BS_STANDBY-1 && tgtBS<cur) continue;
         if(P[16]==0 && cur<BS_STANDBY-1) continue;   // TR=0: isi 1x
         MovePending(bs[k],tgtBS);
        }
   if(tgtSS>0 && movableSS && rsiSS)
      for(int k=0;k<ArraySize(ss);k++)
        {
         if(!OrderSelect(ss[k])) continue;
         if(PendingParked(ss[k])) continue;
         double cur=OrderGetDouble(ORDER_PRICE_OPEN);
         if(ema>0 && tgtSS>=ema) continue;
         if(awaySS && cur>SS_STANDBY+1 && tgtSS>cur) continue;
         if(P[16]==0 && cur>SS_STANDBY+1) continue;
         MovePending(ss[k],tgtSS);
        }
   return false;
  }

void StepMagic(int idx)
  {
   int magic=g_magic[idx];
   int ti,tm,tz,te,tx;
   DecodeMagic(magic,ti,tm,tz,te,tx);
   if(ti==3 || ti==8 || ti==9)
     {
      static bool warned=false;
      if(!warned) { Print("Teknik i=",ti," belum diporting (v2) - magic ",magic," dilewati"); warned=true; }
      return;
     }
   if(!EnsureHandles(te)) return;

   int    nBuys =CountPos(magic,1),  nSells=CountPos(magic,-1);
   double maxBuy=MaxLotDir(magic,1), maxSell=MaxLotDir(magic,-1);
   bool   equal =EqualLotMode(ti,tz,te);
   int    level;
   if(equal) level=MathMin(nBuys,nSells);
   else      level=LevelFromLot(idx,MathMax(maxBuy,maxSell));

   ulong anyBS[],anySS[];
   PendTickets(magic,ORDER_TYPE_BUY_STOP,0,anyBS);
   PendTickets(magic,ORDER_TYPE_SELL_STOP,0,anySS);

   // PINDAI/seed pasangan siaga saat magic kosong
   if(InpAutoSeed && nBuys+nSells==0 && ArraySize(anyBS)+ArraySize(anySS)==0
      && HoursOK() && !g_marginLow)
     {
      SeedPair(magic,g_initLot[idx]);
      PendTickets(magic,ORDER_TYPE_BUY_STOP,0,anyBS);
      PendTickets(magic,ORDER_TYPE_SELL_STOP,0,anySS);
     }

   // LAWAN
   if(equal)
     {
      if(nBuys+nSells>0 || HoursOK())
         LawanPasangan(idx,ti,level);
     }
   else
      LawanMarti(idx,level,maxBuy,maxSell);

   // TEMAN -T
   if(HoursOK() && !g_marginLow)
      Teman(idx,te,maxBuy,maxSell);

   // UPDATE target teknik (return true = magic ditutup cut i=7)
   if(ApplyTargets(idx,ti,te,level,maxBuy,maxSell,nBuys,nSells,equal))
      return;

   // PENGAMAN level
   if(P[23]>0)   // maxLevCut
     {
      if(equal)
        {
         bool locked=(nBuys>0 && nBuys==nSells &&
                      MathAbs(SumLotDir(magic,1)-SumLotDir(magic,-1))<1e-9);
         if(locked && nBuys>=(int)P[23]) { TutupMagic(idx); return; }
        }
      else if(level>=(int)P[23] && nBuys+nSells>0)
        { TutupMagic(idx); return; }
     }
   if(P[22]>0 && level>=(int)P[22] && !equal)
      g_lvlParked[idx]=true;   // rem: berhenti memproses pending magic ini

   // EXIT per magic
   double fl=FloatingMagic(magic);
   if(nBuys+nSells==0) { g_worst[idx]=0; return; }
   g_worst[idx]=MathMin(g_worst[idx],fl);
   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   if(P[1]>0 && fl> P[1]/100.0*bal)          { TutupMagic(idx); return; }
   if(P[4]>0 && fl<-P[4])                    { TutupMagic(idx); return; }
   if(P[5]>0 && fl<-P[5]/100.0*bal)          { TutupMagic(idx); return; }
   if(P[9]>0 && g_worst[idx]<0)
     {
      double rr=SplitX(P[9]);
      int startLv=(int)MathRound(SplitY(P[9])*10.0);
      if(rr>0 && level>=startLv && fl>rr*MathAbs(g_worst[idx]))
        { TutupMagic(idx); return; }
     }
  }

//=================== REMOTE: LS KENDALI & LS PARAM ==================
ulong FindKendali()
  {
   for(int k=OrdersTotal()-1;k>=0;k--)
     {
      ulong t=OrderGetTicket(k);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)==MAGIC_KENDALI &&
         (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE)==ORDER_TYPE_SELL_LIMIT)
         return t;
     }
   return 0;
  }

void EnsureKendali()
  {
   if(FindKendali()!=0) return;
   trade.SetExpertMagicNumber(MAGIC_KENDALI);
   if(!trade.SellLimit(1.0,PRICE_KENDALI,_Symbol,0,0,ORDER_TIME_GTC,0,"LS-Kendali"))
      Print("Gagal membuat LS Kendali: ",trade.ResultRetcodeDescription());
  }

ulong FindParamSlot(int slot)
  {
   double price=PRICE_PARAM_0+slot;
   for(int k=OrdersTotal()-1;k>=0;k--)
     {
      ulong t=OrderGetTicket(k);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)!=MAGIC_PARAM) continue;
      if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN)-price)<0.5) return t;
     }
   return 0;
  }

void ShowParamSlot(int slot)
  {
   if(slot<1 || slot>29) return;
   if(FindParamSlot(slot)!=0) return;
   trade.SetExpertMagicNumber(MAGIC_PARAM);
   double price=PRICE_PARAM_0+slot;
   if(trade.SellLimit(1.0,price,_Symbol,0,0,ORDER_TIME_GTC,0,
                      "LS-P"+IntegerToString(slot)))
     {
      ulong t=FindParamSlot(slot);
      if(t!=0) trade.OrderModify(t,price,0,P[slot],ORDER_TIME_GTC,0,0);
     }
  }

void ShowAllParams()  { for(int s=1;s<=29;s++) ShowParamSlot(s); }

void DeleteAllParams()
  {
   for(int k=OrdersTotal()-1;k>=0;k--)
     {
      ulong t=OrderGetTicket(k);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)==MAGIC_PARAM) trade.OrderDelete(t);
     }
  }

void SyncParams()
  {
   for(int k=OrdersTotal()-1;k>=0;k--)
     {
      ulong t=OrderGetTicket(k);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      if((int)OrderGetInteger(ORDER_MAGIC)!=MAGIC_PARAM) continue;
      int slot=(int)MathRound(OrderGetDouble(ORDER_PRICE_OPEN)-PRICE_PARAM_0);
      if(slot<1 || slot>29) continue;
      double v=OrderGetDouble(ORDER_TP);
      if(MathAbs(v-P[slot])>1e-9)
        {
         P[slot]=v;
         Print("LS Param slot ",slot," -> ",DoubleToString(v,4));
        }
     }
  }

void AddMagic(int magic,double lot)
  {
   int i,m,z,e,x;
   DecodeMagic(magic,i,m,z,e,x);
   if(i<1 || i>9 || e<1 || e>7) { Print("Magic tidak valid: ",magic); return; }
   for(int k=0;k<ArraySize(g_magic);k++)
      if(g_magic[k]==magic) return;
   if(lot<=0) lot=AutoLot();
   int n=ArraySize(g_magic);
   ArrayResize(g_magic,n+1);    g_magic[n]=magic;
   ArrayResize(g_initLot,n+1);  g_initLot[n]=NormLot(lot);
   ArrayResize(g_worst,n+1);    g_worst[n]=0;
   ArrayResize(g_temanN,n+1);   g_temanN[n]=0;
   ArrayResize(g_frUp,n+1);     g_frUp[n]=0;
   ArrayResize(g_frDn,n+1);     g_frDn[n]=0;
   ArrayResize(g_lastClose,n+1);g_lastClose[n]=0;
   ArrayResize(g_lvlParked,n+1);g_lvlParked[n]=false;
   EnsureHandles(e);
   if(z>=1 && z<=7) EnsureHandles(z);
   if(x>=1 && x<=7) EnsureHandles(x);
   Print("Magic aktif: ",magic," lot ",DoubleToString(g_initLot[n],2));
  }

void ExecKendali(double tp)
  {
   long whole=(long)MathFloor(tp);
   double frac=tp-(double)whole;
   int digits=(int)StringLen(IntegerToString(whole));

   if(digits<=2)
     {
      int w=(int)whole;
      if(w>=1 && w<=25)      ShowParamSlot(w);
      else if(w==94) { ParamDefaults(); DeleteAllParams(); ShowAllParams(); }
      else if(w==95) ShowAllParams();
      else if(w==96) DeleteAllParams();
      else if(w==97)   // close all posisi (LS tetap)
        {
         for(int k=PositionsTotal()-1;k>=0;k--)
           {
            ulong t=PositionGetTicket(k);
            if(t!=0 && PositionGetString(POSITION_SYMBOL)==_Symbol)
               trade.PositionClose(t);
           }
        }
      else if(w==98)   // close all + hapus semua pending non-remote
        {
         for(int k=PositionsTotal()-1;k>=0;k--)
           {
            ulong t=PositionGetTicket(k);
            if(t!=0 && PositionGetString(POSITION_SYMBOL)==_Symbol)
               trade.PositionClose(t);
           }
         for(int k=OrdersTotal()-1;k>=0;k--)
           {
            ulong t=OrderGetTicket(k);
            if(t==0) continue;
            if(OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
            int mg=(int)OrderGetInteger(ORDER_MAGIC);
            if(mg==MAGIC_KENDALI || mg==MAGIC_PARAM) continue;
            trade.OrderDelete(t);
           }
        }
      // 99 = standby
      return;
     }

   if(digits==3)   // E LL -> teknik 1 default
     {
      int e=(int)(whole/100), ll=(int)(whole%100);
      AddMagic(10000+0*1000+100+e*10+0,ll+frac);
      return;
     }
   if(digits==5)   // Z E X LL, mm=10 default
     {
      int z=(int)(whole/10000), e=(int)((whole/1000)%10);
      int x=(int)((whole/100)%10), ll=(int)(whole%100);
      AddMagic(10000+z*100+e*10+x,ll+frac);
      return;
     }
   if(digits==7)   // mm Z E X LL
     {
      int mm=(int)(whole/100000), z=(int)((whole/10000)%10);
      int e=(int)((whole/1000)%10), x=(int)((whole/100)%10);
      int ll=(int)(whole%100);
      AddMagic((mm/10)*10000+(mm%10)*1000+z*100+e*10+x,ll+frac);
      return;
     }
   if(digits==8)   // [cmd][mm][Z][E][X][LL]
     {
      int c=(int)(whole/10000000);
      int mm=(int)((whole/100000)%100), z=(int)((whole/10000)%10);
      int e=(int)((whole/1000)%10), x=(int)((whole/100)%10);
      int ll=(int)(whole%100);
      int magic=(mm/10)*10000+(mm%10)*1000+z*100+e*10+x;
      double lot=ll+frac; if(lot<=0) lot=AutoLot();
      if(c==1)      { AddMagic(magic,lot); PlacePending(magic,true ,lot,BS_STANDBY,"",false); }
      else if(c==2) { AddMagic(magic,lot); PlacePending(magic,false,lot,SS_STANDBY,"",false); }
      else if(c==3) { AddMagic(magic,lot); MarketOrder(magic, 1,lot); }
      else if(c==4) { AddMagic(magic,lot); MarketOrder(magic,-1,lot); }
      else if(c==8) Print("LS Loop belum diporting (v2)");
      return;
     }
   Print("Perintah LS Kendali tidak dikenal: ",DoubleToString(tp,2));
  }

void ReadKendali()
  {
   ulong t=FindKendali();
   if(t==0) { EnsureKendali(); return; }
   if(!OrderSelect(t)) return;
   double tp=OrderGetDouble(ORDER_TP);
   if(tp<=0) return;
   ExecKendali(tp);
   trade.OrderModify(t,OrderGetDouble(ORDER_PRICE_OPEN),
                     OrderGetDouble(ORDER_SL),0,ORDER_TIME_GTC,0,0);
  }

//=================== SIKLUS UTAMA ===================================
void Cycle()
  {
   if(TimeCurrent()==g_lastCycle) return;   // throttle 1 detik
   g_lastCycle=TimeCurrent();

   // remote LS hanya di akun live/demo (di Strategy Tester TP order
   // tidak bisa diedit manual, jadi remote tidak berguna di sana)
   if(InpUseRemote && !MQLInfoInteger(MQL_TESTER))
     { ReadKendali(); SyncParams(); }

   // exit global: exitUSD / exitBid / exitBidMin
   double flAll=FloatingMagic(-1);
   if((P[2]>0 && flAll>P[2]) ||
      (P[10]>0 && Bid()>P[10]) ||
      (P[11]>0 && Bid()<P[11]))
     {
      for(int k=0;k<ArraySize(g_magic);k++) TutupMagic(k);
      return;
     }

   for(int k=0;k<ArraySize(g_magic);k++) StepMagic(k);

   // rem margin (dokumen: pending diparkir; deviasi: lepas otomatis
   // saat margin pulih agar operasi berlanjut)
   if(P[6]>0)
     {
      double ml=AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
      g_marginLow=(ml>0 && ml<P[6]);
     }
   else g_marginLow=false;
  }

//=================== EVENT HANDLER ==================================
int OnInit()
  {
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE)
      !=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      Alert("PERINGATAN: akun bukan hedging - EA ini butuh akun hedging!");

   // pilih filling otomatis: FOK -> IOC -> RETURN (spt prompt simple)
   long fill=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   if((fill&SYMBOL_FILLING_FOK)!=0)      trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((fill&SYMBOL_FILLING_IOC)!=0) trade.SetTypeFilling(ORDER_FILLING_IOC);
   else                                  trade.SetTypeFilling(ORDER_FILLING_RETURN);
   trade.SetDeviationInPoints(50);

   ParamDefaults();
   ArrayInitialize(hMACD,0); ArrayInitialize(hFract,0);
   ArrayInitialize(hATR,0);  ArrayInitialize(hADX,0); ArrayInitialize(hRSI,0);

   string parts[];
   int n=StringSplit(InpMagics,',',parts);
   for(int k=0;k<n;k++)
     {
      string s=parts[k];
      StringTrimLeft(s); StringTrimRight(s);
      if(StringLen(s)==0) continue;
      AddMagic((int)StringToInteger(s),InpLot);
     }
   if(ArraySize(g_magic)==0)
      Print("Tidak ada magic aktif - EA menunggu perintah LS Kendali");

   if(InpUseRemote && !MQLInfoInteger(MQL_TESTER)) EnsureKendali();

   EventSetTimer(1);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTick()  { Cycle(); }
void OnTimer() { Cycle(); }
//+------------------------------------------------------------------+
