import axios from "axios";
import cos from "cos-nodejs-sdk-v5";
import stream from "stream";

export default async function handler(req, res) {
  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 测试端点 - 返回示例数据
  if (req.method === "GET" && req.query.test === "true") {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const testData = {
      payment_id: `test_${Date.now()}`,
      invoice_id: `INV-TEST-${Math.floor(Math.random() * 10000)}`,
      order_id: "test_product",
      order_description: "Test Product",
      price_amount: 9.99,
      price_currency: "USD",
      pay_amount: 0.0001,
      pay_currency: "BTC",
      actually_paid: 0.0001,
      pay_address: "test_address_123",
      payment_status: "finished",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      customer_email: "test@example.com"
    };

    return res.status(200).json({
      success: true,
      message: "Test data generated",
      test_data: testData,
      instructions: "Use POST method with this data to test the endpoint"
    });
  }

  // 只允许 POST 请求
  if (req.method !== "POST") {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed"
    });
  }

  // 为所有响应设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    console.log("Received NowPayments callback:", {
      headers: req.headers,
      body: req.body
    });

    // 解析请求数据
    let paymentData;
    if (typeof req.body === "string") {
      try {
        paymentData = JSON.parse(req.body);
      } catch (e) {
        // 尝试解析为 URL 编码格式
        try {
          paymentData = {};
          const params = new URLSearchParams(req.body);
          for (const [key, value] of params) {
            paymentData[key] = value;
          }
        } catch (parseError) {
          console.error("Failed to parse body:", parseError);
          return res.status(400).json({
            success: false,
            message: "Invalid data format"
          });
        }
      }
    } else if (typeof req.body === "object") {
      paymentData = req.body;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid request body"
      });
    }

    console.log("Parsed payment data:", paymentData);

    // 验证必需字段
    if (!paymentData.payment_id) {
      return res.status(400).json({
        success: false,
        message: "payment_id is required"
      });
    }

    // 企业微信 Webhook URL
    const tencent_webhook = process.env.WECHAT_WEBHOOK_URL || 
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a4d9df92-14dd-4d90-8f37-4f4ac46662a3";

    // 构建企业微信消息
    const statusEmoji = {
      "waiting": "⏳",
      "confirming": "🔍",
      "confirmed": "✅",
      "sending": "🚚",
      "partially_paid": "💰",
      "finished": "🎉",
      "failed": "❌",
      "refunded": "↩️",
      "expired": "⌛"
    }[paymentData.payment_status] || "📊";

    const markdownContent = `💰 **NowPayments 支付通知** ${statusEmoji}

📊 **支付信息**
- 支付ID: \`${paymentData.payment_id}\`
- 状态: **${paymentData.payment_status || "unknown"}**
- 金额: ${paymentData.pay_amount || paymentData.price_amount || "0"} ${paymentData.pay_currency || paymentData.price_currency || "USD"}

📝 **订单详情**
- 订单ID: ${paymentData.invoice_id || paymentData.order_id || "N/A"}
- 商品: ${paymentData.order_description || "N/A"}
- 邮箱: ${paymentData.customer_email || paymentData.payer_email || "未提供"}

⏰ **时间**
- 创建: ${paymentData.created_at || new Date().toISOString()}
- 更新: ${paymentData.updated_at || new Date().toISOString()}

💳 **支付详情**
- 地址: \`${paymentData.pay_address || "N/A"}\`
- 实际支付: ${paymentData.actually_paid || paymentData.pay_amount || "0"}`;

    // 发送到企业微信
    try {
      const mst_data = {
        msgtype: "markdown",
        markdown: {
          content: markdownContent
        },
      };

      await axios.post(tencent_webhook, mst_data);
      console.log("✅ WeChat notification sent successfully");
    } catch (webhookError) {
      console.error("❌ Failed to send WeChat notification:", webhookError.message);
      // 继续处理，不因微信通知失败而终止
    }

    // 存储到腾讯云 COS
    try {
      const secretId = process.env.COS_KEY;
      const secretKey = process.env.COS_SECRET;
      const bucket = process.env.COS_BUCKET || 'webtool-1254457405';
      const region = process.env.COS_REGION || 'ap-singapore';

      if (!secretId || !secretKey) {
        console.warn("⚠️ COS credentials not configured, skipping storage");
      } else {
        const cosInstance = new cos({
          SecretId: secretId,
          SecretKey: secretKey
        });

        // 生成文件名
        const currentDate = new Date().toISOString().slice(0, 10);
        const fileName = `/nowpayments/${currentDate}/${paymentData.payment_id}.json`;

        // 准备存储的数据
        const paymentRecord = {
          ...paymentData,
          received_at: new Date().toISOString(),
          source: "nowpayments_callback"
        };

        // 创建可读流
        const readableStream = new stream.Readable();
        readableStream.push(JSON.stringify(paymentRecord, null, 2));
        readableStream.push(null);

        await cosInstance.putObject({
          Bucket: bucket,
          Region: region,
          Key: fileName,
          Body: readableStream,
          ContentType: 'application/json'
        });

        console.log('📁 Payment record uploaded to COS:', fileName);
      }
    } catch (cosError) {
      console.error('❌ Failed to upload to COS:', cosError.message);
      // 继续处理，不因存储失败而终止
    }

    // 根据支付状态处理业务逻辑
    if (["finished", "confirmed", "success"].includes(paymentData.payment_status)) {
      console.log(`🎊 Payment ${paymentData.payment_id} completed successfully`);
      
      // 这里添加你的业务逻辑
      // 例如：激活用户权限、发送确认邮件等
      if (paymentData.customer_email || paymentData.payer_email) {
        const userEmail = paymentData.customer_email || paymentData.payer_email;
        console.log(`📧 Should send confirmation email to: ${userEmail}`);
        // 这里可以调用邮件发送服务
      }
    }

    // 返回成功响应给 NowPayments
    return res.status(200).json({
      success: true,
      message: "Callback received successfully",
      payment_id: paymentData.payment_id,
      status: paymentData.payment_status,
      processed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Callback processing error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
