import axios from "axios";
import cos from "cos-nodejs-sdk-v5";
import stream from "stream";

// NowPayments IPN 验证密钥（在 NowPayments 后台设置）
const IPN_SECRET_KEY = process.env.NOWPAYMENTS_IPN_SECRET || "";

export default async function handler(req, res) {
  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
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
    // 获取原始请求体（用于签名验证）
    const rawBody = req.body;
    const signature = req.headers["x-nowpayments-sig"];
    
    console.log("Received IPN request:", {
      body: rawBody,
      signature: signature
    });

    // 验证 IPN 签名
    if (IPN_SECRET_KEY) {
      const expectedSignature = crypto
        .createHmac("sha512", IPN_SECRET_KEY)
        .update(JSON.stringify(rawBody))
        .digest("hex");

      if (signature !== expectedSignature) {
        console.error("IPN signature verification failed");
        return res.status(401).json({
          success: false,
          message: "Invalid signature"
        });
      }
      console.log("IPN signature verified successfully");
    }

    // 解析 IPN 数据
    let paymentData;
    
    // 检查是否是字符串格式
    if (typeof rawBody === "string") {
      try {
        // 尝试解析 JSON 字符串
        paymentData = JSON.parse(rawBody);
      } catch (e) {
        // 如果不是 JSON，可能是查询字符串格式
        try {
          paymentData = {};
          const params = new URLSearchParams(rawBody);
          for (const [key, value] of params) {
            paymentData[key] = value;
          }
        } catch (parseError) {
          console.error("Failed to parse IPN body:", parseError);
          return res.status(400).json({
            success: false,
            message: "Invalid IPN data format"
          });
        }
      }
    } else if (typeof rawBody === "object") {
      // 如果已经是对象（Vercel 可能自动解析了 JSON）
      paymentData = rawBody;
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported IPN data format"
      });
    }

    console.log("Parsed payment data:", paymentData);

    // 验证必需字段
    const requiredFields = ["payment_id", "invoice_id", "payment_status", "pay_amount", "pay_currency"];
    const missingFields = requiredFields.filter(field => !paymentData[field]);
    
    if (missingFields.length > 0) {
      console.error("Missing required fields:", missingFields);
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`
      });
    }

    // 企业微信 Webhook URL
    const tencent_webhook = process.env.WECHAT_WEBHOOK_URL || 
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a4d9df92-14dd-4d90-8f37-4f4ac46662a3";

    // 构建企业微信消息
    const markdownContent = `💰 NowPayments 支付通知

📊 **支付状态更新**
- 支付ID：${paymentData.payment_id}
- 订单ID：${paymentData.invoice_id || "N/A"}
- 状态：${paymentData.payment_status}
- 金额：${paymentData.pay_amount} ${paymentData.pay_currency}
- 实际金额：${paymentData.actually_paid || paymentData.pay_amount} ${paymentData.pay_currency}
- 支付地址：${paymentData.pay_address || "N/A"}

📝 **订单信息**
- 商品名称：${paymentData.order_id || paymentData.invoice_id || "N/A"}
- 用户邮箱：${paymentData.email || paymentData.customer_email || "未提供"}

⏰ **时间信息**
- 创建时间：${paymentData.created_at || "N/A"}
- 更新时间：${paymentData.updated_at || "N/A"}

🔗 **查看详情**
[NowPayments 后台](https://nowpayments.io/dashboard)`;

    try {
      // 发送到企业微信
      const mst_data = {
        msgtype: "markdown",
        markdown: {
          content: markdownContent
        },
      };

      await axios.post(tencent_webhook, mst_data);
      console.log("WeChat notification sent successfully");

    } catch (webhookError) {
      console.error("Failed to send WeChat notification:", webhookError.message);
      // 继续处理，不因微信通知失败而终止
    }

    // 存储到腾讯云 COS
    try {
      const secretId = process.env.COS_KEY;
      const secretKey = process.env.COS_SECRET;
      const bucket = process.env.COS_BUCKET || 'webtool-1254457405';
      const region = process.env.COS_REGION || 'ap-singapore';

      if (!secretId || !secretKey) {
        console.error("COS credentials not configured");
      } else {
        const cosInstance = new cos({
          SecretId: secretId,
          SecretKey: secretKey
        });

        // 生成文件名
        const randomString = Math.random().toString(36).substring(2, 12);
        const currentDate = new Date().toISOString().slice(0, 10);
        const fileName = `/nowpayments/payments/${currentDate}_${paymentData.payment_id}_${randomString}.json`;

        // 准备存储的数据
        const paymentRecord = {
          ...paymentData,
          ipn_received_at: new Date().toISOString(),
          ipn_verified: !!IPN_SECRET_KEY
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

        console.log('Payment record uploaded to COS:', fileName);
      }
    } catch (cosError) {
      console.error('Failed to upload to COS:', cosError.message);
      // 继续处理，不因存储失败而终止
    }

    // 根据支付状态进行业务处理
    if (paymentData.payment_status === "finished" || 
        paymentData.payment_status === "confirmed") {
      
      // 这里添加你的业务逻辑
      // 例如：激活用户权限、发送确认邮件等
      console.log(`Payment ${paymentData.payment_id} completed successfully`);
      
      // 示例：如果有用户邮箱，可以发送确认邮件
      if (paymentData.email || paymentData.customer_email) {
        const userEmail = paymentData.email || paymentData.customer_email;
        console.log(`Send confirmation email to: ${userEmail}`);
        // 这里可以调用邮件发送服务
      }
    }

    // 返回成功响应给 NowPayments
    return res.status(200).json({
      success: true,
      message: "IPN received and processed successfully",
      data: {
        payment_id: paymentData.payment_id,
        status: paymentData.payment_status,
        processed_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("IPN processing error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
