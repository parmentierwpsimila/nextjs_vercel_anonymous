import axios from "axios";

export default async function handler(req, res) {
  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 只允许 POST 请求
  if (req.method !== "POST") {
    // 为错误响应也设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ 
      success: false,
      message: "Method Not Allowed" 
    });
  }

  // 为所有响应设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { body } = req;

  // 验证必需字段
  if (!body.type || !body.email) {
    return res.status(400).json({ 
      success: false,
      message: "Missing required fields: type and email are required" 
    });
  }

  const request_type = parseInt(body.type);
  const user_email = body.email;
  const url = body.url || "Not provided";
  
  // 企业微信 Webhook URL
  const tencent_webhook =
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a4d9df92-14dd-4d90-8f37-4f4ac46662a3";

  // 根据不同的 request_type 生成不同的消息内容
  let markdownContent = "";
  let responseMessage = "";

  switch (request_type) {
    case 1: // 订阅
      markdownContent = `📧 **灰度洞察--新闻订阅申请**\n
**邮箱地址：** ${user_email}\n
**订阅时间：** ${new Date().toLocaleString("zh-CN")}\n
**用户请求：** 订阅新闻通讯，接收最新情报分析`;
      responseMessage = "Subscription request received. Thank you for subscribing!";
      break;

    case 2: // 月度会员
      markdownContent = `💰 **月度会员申请**\n
**邮箱地址：** ${user_email}\n
**申请时间：** ${new Date().toLocaleString("zh-CN")}\n
**会员类型：** 月度会员\n
**来源页面：** ${url}\n
**用户请求：** 申请月度会员，需要发送确认邮件`;
      responseMessage = "Monthly membership request received. Confirmation email will be sent shortly.";
      break;

    case 3: // 年度会员
      markdownContent = `💎 **灰度洞察--年度会员申请**\n
**邮箱地址：** ${user_email}\n
**申请时间：** ${new Date().toLocaleString("zh-CN")}\n
**会员类型：** 年度会员\n
**来源页面：** ${url}\n
**用户请求：** 申请年度会员，需要发送确认邮件`;
      responseMessage = "Annual membership request received. Confirmation email will be sent shortly.";
      break;

    case 4: // 支付下载
      markdownContent = `🛒 **灰度洞察--支付下载申请**\n
**邮箱地址：** ${user_email}\n
**申请时间：** ${new Date().toLocaleString("zh-CN")}\n
**下载页面：** ${url}\n
**用户请求：** 支付下载当前页面内容\n
**重要提示：** 需要向用户发送支付链接和下载地址`;
      responseMessage = "Payment and download request received. Payment instructions will be sent to your email.";
      break;

    default:
      markdownContent = `❓ **灰度洞察--未知类型申请**\n
**邮箱地址：** ${user_email}\n
**请求类型：** ${request_type} (未识别)\n
**来源页面：** ${url}\n
**申请时间：** ${new Date().toLocaleString("zh-CN")}`;
      responseMessage = "Request received. We'll process your request shortly.";
  }

  try {
    // 准备企业微信消息数据
    const mst_data = {
      msgtype: "markdown",
      markdown: {
        content: markdownContent
      },
    };

    // 使用 axios 发送 POST 请求到企业微信 Webhook
    const response = await axios.post(tencent_webhook, mst_data);

    // 记录日志（可选）
    console.log(`Request processed - Type: ${request_type}, Email: ${user_email}, URL: ${url}`);

    // 返回成功响应给客户端
    return res.status(200).json({ 
      success: true,
      message: responseMessage,
      data: {
        type: request_type,
        email: user_email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    
    // 根据错误类型返回不同的响应
    if (error.response) {
      return res.status(502).json({ 
        success: false,
        message: "Webhook service error",
        error: error.response.data
      });
    } else if (error.request) {
      return res.status(504).json({ 
        success: false,
        message: "Webhook request timeout",
        error: "No response received from webhook service"
      });
    } else {
      return res.status(500).json({ 
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
}