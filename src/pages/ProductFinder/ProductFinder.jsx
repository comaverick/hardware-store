import { useEffect, useRef, useState } from "react";
import { CameraOutlined, CheckCircleFilled, LockOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Spin, Tag, Typography, message } from "antd";
import api from "../../services/api";
import "./ProductFinder.css";

const { Title, Text } = Typography;

const ProductFinder = () => {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const [imageData, setImageData] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [result, setResult] = useState(null);
  const [reserveTarget, setReserveTarget] = useState(null);
  const [savingReservation, setSavingReservation] = useState(false);
  const [form] = Form.useForm();

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!cameraOpen || !video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => message.error("The camera preview could not start. Try opening it again."));
  }, [cameraOpen]);

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setResult(null);
      setCameraOpen(true);
    } catch {
      message.error("Camera access was not granted. You can upload a photo instead.");
    }
  };

  const loadImage = (file) => {
    if (!file?.type?.startsWith("image/")) return message.error("Choose an image file.");
    if (file.size > 6 * 1024 * 1024) return message.error("Choose an image smaller than 6 MB.");
    const reader = new FileReader();
    reader.onload = () => { setImageData(reader.result); setResult(null); };
    reader.readAsDataURL(file);
  };

  const identifyImage = async (image) => {
    if (!image) return;
    try {
      setIdentifying(true);
      const response = await api.post("/product-finder/identify", { imageData: image });
      setResult(response.data);
    } catch (error) {
      message.error(error.response?.data?.message || "Could not identify this item.");
    } finally {
      setIdentifying(false);
    }
  };

  const scanCameraFrame = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return message.warning("Wait for the camera preview, then scan again.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const frame = canvas.toDataURL("image/jpeg", 0.8);
    setImageData(frame);
    identifyImage(frame);
  };

  const reserveAtBranch = (product, branch, available) => {
    setReserveTarget({ product, branch, available });
    form.setFieldsValue({ quantity: 1, holdMinutes: 120, customerName: "", customerPhone: "" });
  };

  const createReservation = async (values) => {
    if (!reserveTarget) return;
    try {
      setSavingReservation(true);
      await api.post("/reservations", {
        branch: reserveTarget.branch._id, product: reserveTarget.product._id,
        quantity: values.quantity, customerName: values.customerName, customerPhone: values.customerPhone,
        expiresAt: new Date(Date.now() + values.holdMinutes * 60000).toISOString(),
      });
      message.success(`Reserved at ${reserveTarget.branch.name}.`);
      setReserveTarget(null);
      form.resetFields();
    } catch (error) {
      message.error(error.response?.data?.message || "Could not create the reservation.");
    } finally { setSavingReservation(false); }
  };

  const renderResults = () => {
    if (identifying) return <Card className="finder-loading"><Spin size="large" /><strong>Analysing this view…</strong><Text type="secondary">We will give you a camera instruction if another scan is needed.</Text></Card>;
    if (!result) return <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Open the camera and scan the item" /></Card>;

    const recognisedName = result.identifiedName || result.matches?.[0]?.product?.name || result.description || "";

    return <>
      <Card className={`finder-guidance ${result.shouldRescan ? "finder-guidance-rescan" : ""}`}>
        <div className="finder-guidance-icon"><CameraOutlined /></div>
        <div><Text strong>{recognisedName || (result.shouldRescan ? "Scan again" : "Item analysed")}</Text><div>{result.guidance}</div>{result.description && recognisedName !== result.description && <Text type="secondary">{result.description}</Text>}</div>
      </Card>
      {result.matches.length === 0 ? <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={recognisedName ? `${recognisedName} — not in our catalogue` : "No catalogue match yet"} /><Text type="secondary">{result.shouldRescan ? "Follow the instruction above and scan again." : "We identified the item, but it is not listed in this store catalogue."}</Text></Card> : <>
        <div className="finder-result-intro"><CheckCircleFilled /><div><strong>Catalogue matches</strong><span>Review the match and live availability before reserving.</span></div></div>
        {result.matches.map((match) => <Card className="finder-match-card" key={match.product._id}>
          <div className="finder-match-heading"><div><Title level={4}>{match.product.name}</Title><Text type="secondary">{match.product.brand || "Hardware"} · {match.product.sku} · ₱{Number(match.product.sellingPrice).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</Text></div><Tag color={match.availability.length ? "green" : "red"}>{match.availability.length ? "Available" : "Out of stock"}</Tag></div>
          {match.availability.length ? <div className="finder-branches">{match.availability.map((item) => <div className="finder-branch" key={item.branch._id}><div><strong>{item.branch.name}</strong><span>{item.branch.code} · {item.available} {match.product.unit} available</span></div><Button type="primary" onClick={() => reserveAtBranch(match.product, item.branch, item.available)}>Reserve</Button></div>)}</div> : <Text type="secondary">We identified this product, but it is out of stock at every branch.</Text>}
        </Card>)}
      </>}
    </>;
  };

  return <div className="finder-page">
    <div className="finder-header"><div><Title level={2}>AI Product Finder</Title><Text type="secondary">Scan an item, follow the camera guidance, then find or reserve it.</Text></div><Tag color="blue">Guided scan</Tag></div>
    <div className="finder-layout"><Card className="finder-capture-card"><div className="finder-capture">{cameraOpen ? <video ref={videoRef} autoPlay playsInline className="finder-video" /> : imageData ? <img src={imageData} alt="Item to identify" className="finder-preview" /> : <div className="finder-empty-camera"><CameraOutlined /><strong>Ready to scan an item</strong><span>Show its label, brand, shape, or size marking.</span></div>}</div>
      <input ref={fileInputRef} className="finder-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => loadImage(event.target.files?.[0])} />
      <div className="finder-actions">{cameraOpen ? <><Button onClick={stopCamera}>Close camera</Button><Button type="primary" icon={<SearchOutlined />} loading={identifying} onClick={scanCameraFrame}>Scan this view</Button></> : <><Button size="large" icon={<CameraOutlined />} onClick={openCamera}>Open camera</Button><Button size="large" icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>Upload image</Button></>}</div>
      {cameraOpen && <Text className="finder-camera-tip" type="secondary">Keep the item centered. Scan, follow the instruction, then scan again.</Text>}
      {imageData && !cameraOpen && <div className="finder-identify-actions"><Button icon={<ReloadOutlined />} onClick={() => { setImageData(""); setResult(null); }}>Use another photo</Button><Button type="primary" size="large" icon={<SearchOutlined />} loading={identifying} onClick={() => identifyImage(imageData)}>Identify item</Button></div>}
    </Card><section className="finder-results">{renderResults()}</section></div>
    <Modal title="Reserve item for pickup" open={Boolean(reserveTarget)} onCancel={() => setReserveTarget(null)} footer={null} destroyOnClose>{reserveTarget && <><div className="finder-reserve-summary"><strong>{reserveTarget.product.name}</strong><span>{reserveTarget.branch.name} · {reserveTarget.available} available</span></div><Form form={form} layout="vertical" onFinish={createReservation}><Form.Item name="customerName" label="Customer name" rules={[{ required: true, message: "Enter the customer name." }]}><Input autoFocus /></Form.Item><Form.Item name="customerPhone" label="Customer phone"><Input /></Form.Item><div className="finder-form-grid"><Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}><InputNumber min={1} max={reserveTarget.available} className="full-width" /></Form.Item><Form.Item name="holdMinutes" label="Hold time (minutes)" rules={[{ required: true }]}><InputNumber min={15} max={10080} className="full-width" /></Form.Item></div><Button type="primary" htmlType="submit" block size="large" loading={savingReservation} icon={<LockOutlined />}>Confirm reservation</Button></Form></>}</Modal>
  </div>;
};

export default ProductFinder;
