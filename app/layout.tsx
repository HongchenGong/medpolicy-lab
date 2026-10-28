import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'MedPolicy Lab｜卫生经济学研究协作平台',description:'温州医科大学《卫生经济学》第7组研究协作工作台'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
