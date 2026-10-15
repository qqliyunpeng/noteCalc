import { IconClose } from "./Icons";

interface HelpPanelProps {
  onClose: () => void;
}

/** Port of `HELP_HTML` from ui_config.py. */
export function HelpPanel({ onClose }: HelpPanelProps) {
  return (
    <aside className="help-panel">
      <header className="help-head">
        <span>快速语法</span>
        <button type="button" title="关闭帮助 (F1)" onClick={onClose}>
          <IconClose size={12} />
        </button>
      </header>
      <div className="help-body">
        <p>
          <b>普通运算</b>
          <br />
          <code>2 + 3 * 4</code>
          <br />
          <code>2^8</code>
        </p>
        <p>
          <b>变量</b>
          <br />
          <code>价格 = 99.5</code>
          <br />
          <code>总价 = 价格 * 5</code>
        </p>
        <p>
          <b>百分比</b>
          <br />
          <code>200 * 15%</code>
        </p>
        <p>
          <b>单位换算</b>
          <br />
          <code>5 kg to g</code>
          <br />
          <code>10 km to m</code>
          <br />
          <code>32 °F to °C</code>
        </p>
        <p>
          <b>等式校验</b>
          <br />
          <code>sqrt(16) = 4</code>
        </p>
        <p>
          <b>函数</b>
          <br />
          <code>sqrt abs pow sin cos tan</code>
          <br />
          <code>log log2 log10 exp</code>
          <br />
          <code>ceil floor round max min mod</code>
        </p>
        <p>
          <b>逐元素数组</b>
          <br />
          <code>[100, 200, 300] / 10</code>
          <br />
          <code>(100, 200, 300) / 10</code>
          <br />
          <code>{"{100, 200, 300} / 10"}</code>
          <br />
          <code>sqrt([1, 4, 9])</code>
          <br />
          括号未闭合时可跨行输入；空行会取消续行。
        </p>
        <p>
          <b>常量</b>
          <br />
          <code>PI</code>、<code>pi</code>、<code>E</code>、<code>e</code>
        </p>
        <p>
          <b>排版</b>
          <br />
          <code># 标题</code>
          <br />
          <code>## 副标题</code>
          <br />
          <code>// 注释</code>
        </p>
        <p>
          <b>快捷键</b>
          <br />
          <code>Ctrl+F / Ctrl+H</code> 查找、替换
          <br />
          <code>Ctrl+Shift+C</code> 复制当前行结果
          <br />
          <code>Ctrl+鼠标滚轮</code> 缩放字号
          <br />
          <code>Tab</code> 接受结果补全
        </p>
      </div>
    </aside>
  );
}