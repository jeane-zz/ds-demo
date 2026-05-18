'use client'

import { useState } from "react";

export default function App() {
  const [text, setText] = useState("");

  const handleChat = async () => {
    const response = await fetch("http://localhost:3000/api/chat");
    // 开始读取服务器流
    const reader = response.body.getReader();

    // 流返回的是 Uint8Array（二进制） 不是字符串
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      // 通过 done 去判断是否还有新的内容
      if (done) break;
      // 流返回的是 Uint8Array（二进制） 所以需要解码
      const chunk = decoder.decode(value);
      // 追加显示
      setText((prev) => prev + chunk);
    }
  };

  return (
    <div>
      <button onClick={handleChat}>
        开始聊天
      </button>

      <pre>{text}</pre>
    </div>
  );
}