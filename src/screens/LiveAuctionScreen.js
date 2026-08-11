import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import BottomNav from "../components/BottomNav";
import ErrorBanner from "../components/ErrorBanner";
import { apiRequest } from "../services/apiClient";
import { colors, radius, spacing, typography } from "../constants/theme";
import { useConnectivity } from "../hooks/useConnectivity";
import { formatStatus } from "../utils/formatters";

const getCountdownSeconds = (roomData) => {
  const auction = roomData?.auction;
  if (!auction) return null;

  if (Number.isFinite(Number(roomData.segundosRestantes))) {
    return Math.max(Number(roomData.segundosRestantes), 0);
  }

  if (Number.isFinite(Number(auction.segundosRestantes))) {
    return Math.max(Number(auction.segundosRestantes), 0);
  }

  const targetDate =
    auction.estado === "proxima"
      ? auction.fechaInicio || auction.fecha_inicio
      : auction.estado === "abierta"
        ? auction.fechaFin || auction.fecha_fin
        : null;

  if (!targetDate) return null;
  const targetTime = new Date(targetDate).getTime();
  if (Number.isNaN(targetTime)) return null;
  return Math.max(Math.ceil((targetTime - Date.now()) / 1000), 0);
};

export default function LiveAuctionScreen({ navigation, route }) {
  const { auctionId } = route.params;
  const { isConnected } = useConnectivity();
  const [state, setState] = useState(null);
  const [payments, setPayments] = useState([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [bidding, setBidding] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [winModal, setWinModal] = useState(null);
  const prevRoomRef = useRef(null);

  const refreshRoom = useCallback(
    async ({ showError = false } = {}) => {
      try {
        const roomData = await apiRequest(`/subastas/${auctionId}/estado`);
        setState(roomData);
        setRemainingSeconds(getCountdownSeconds(roomData));
      } catch (requestError) {
        if (showError) {
          setError(requestError.message);
        }
      }
    },
    [auctionId],
  );

  const loadRoom = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [roomData, paymentData] = await Promise.all([
        apiRequest(`/subastas/${auctionId}/estado`),
        apiRequest("/usuarios/me/pagos"),
      ]);
      setState(roomData);
      setRemainingSeconds(getCountdownSeconds(roomData));
      const compatible = (paymentData.payments || []).filter(
        (payment) =>
          payment.moneda === roomData.auction.moneda && payment.verificado,
      );
      setPayments(paymentData.payments || []);
      setSelectedPaymentId(compatible[0]?.id || null);
      setAmount(String(Math.ceil(roomData.suggestedMinimum || 0)));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [auctionId]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  const isOpen = state?.auction?.estado === "abierta";
  const isUpcoming = state?.auction?.estado === "proxima";
  const isFinished = state?.auction?.estado === "finalizada";
  const isBestBidder = Boolean(state?.isBestBidder);
  const currency = state?.auction?.moneda || "USD";

  useEffect(() => {
    if ((!isOpen && !isUpcoming) || remainingSeconds === null) {
      return undefined;
    }

    if (remainingSeconds <= 0) {
      refreshRoom();
      return undefined;
    }

    const timer = setInterval(() => {
      setRemainingSeconds((current) => {
        if (current === null) return current;
        const next = Math.max(current - 1, 0);
        if (next === 0) {
          refreshRoom();
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, isUpcoming, refreshRoom, remainingSeconds]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      refreshRoom();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [isOpen, refreshRoom]);

  // Detecta cuando el usuario gana un lote: era el mejor postor y el lote
  // cerro (avanzo al siguiente o finalizo la subasta). Muestra el modal de
  // ganador, con opcion de seguir (si quedan productos) o ir a la actividad.
  useEffect(() => {
    if (!state?.auction) {
      return;
    }

    const prev = prevRoomRef.current;
    const current = {
      lotId: state.currentLot?.id ?? null,
      lotTitle: state.currentLot?.titulo ?? "",
      isBestBidder: Boolean(state.isBestBidder),
      estado: state.auction.estado,
    };

    const lotClosed =
      prev &&
      prev.estado === "abierta" &&
      (prev.lotId !== current.lotId || current.estado === "finalizada");

    if (lotClosed && prev.isBestBidder) {
      setWinModal({
        lotTitle: prev.lotTitle,
        moreProducts: current.estado === "abierta",
      });
    }

    prevRoomRef.current = current;
  }, [state]);

  const compatiblePayments = useMemo(
    () =>
      payments.filter(
        (payment) => payment.moneda === currency && payment.verificado,
      ),
    [payments, currency],
  );
  const selectedPayment = useMemo(
    () =>
      compatiblePayments.find((payment) => payment.id === selectedPaymentId),
    [compatiblePayments, selectedPaymentId],
  );
  const hasCompatiblePayment = compatiblePayments.length > 0;

  const formatBidAmountInput = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return "";
    }

    const roundedValue = Math.round(numericValue * 100) / 100;
    return Number.isInteger(roundedValue)
      ? String(roundedValue)
      : roundedValue.toFixed(2);
  };

  const formatBidAmountLabel = (value) => {
    const numericValue = Number(value);
    const hasDecimals = !Number.isInteger(numericValue);
    return `${currency} ${numericValue.toLocaleString("es-AR", {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;
  };

  const handleBid = async (bidAmount = amount) => {
    if (!isOpen) {
      setError(
        isFinished
          ? "La subasta ya finalizó. No se aceptan nuevas pujas."
          : "La subasta todavía no está abierta.",
      );
      return;
    }

    if (isBestBidder) {
      setError("Actualmente tenés la mejor oferta.");
      return;
    }

    if (!isConnected) {
      setError("Sin conexión. No se puede realizar una puja.");
      return;
    }

    if (!hasCompatiblePayment || !selectedPayment) {
      setError(
        "No tenés un medio de pago verificado compatible con esta subasta.",
      );
      return;
    }

    const numericAmount = Number(bidAmount);

    if (!bidAmount || !Number.isFinite(numericAmount)) {
      setError("Ingresá un monto válido.");
      return;
    }

    const currentBestAmount = Number(
      state?.bestBid?.monto || state?.currentLot?.precioBase || 0,
    );
    if (
      Number.isFinite(currentBestAmount) &&
      numericAmount <= currentBestAmount
    ) {
      setError(
        `La puja debe ser mayor a la mejor oferta actual (${formatBidAmountLabel(currentBestAmount)}).`,
      );
      return;
    }

    const minimumBid = Number(state?.suggestedMinimum);
    if (
      Number.isFinite(minimumBid) &&
      minimumBid > 0 &&
      numericAmount < minimumBid
    ) {
      setError(
        `La puja mínima permitida es ${formatBidAmountLabel(minimumBid)}.`,
      );
      return;
    }

    const maximumBid = Number(state?.maximumAllowed);
    const hasMaximumBid =
      state?.maximumAllowed !== null &&
      state?.maximumAllowed !== undefined &&
      Number.isFinite(maximumBid);
    if (hasMaximumBid && numericAmount > maximumBid) {
      setError(
        `La puja máxima permitida es ${formatBidAmountLabel(maximumBid)}.`,
      );
      return;
    }

    setBidding(true);
    setError("");
    setMessage("");

    try {
      await apiRequest(`/subastas/${auctionId}/pujar`, {
        method: "POST",
        body: {
          lote_id: state.currentLot.id,
          medio_pago_id: selectedPaymentId,
          monto: numericAmount,
        },
      });
      setMessage("Puja registrada correctamente.");
      await loadRoom();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBidding(false);
    }
  };

  const handlePresetBid = (bidAmount) => {
    setAmount(formatBidAmountInput(bidAmount));
    handleBid(bidAmount);
  };

  const formatRemaining = (seconds) => {
    if (seconds === null || seconds === undefined) return "";
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  };

  const bestBidAmount = Number(
    state?.bestBid?.monto || state?.currentLot?.precioBase || 0,
  );
  const suggestedMin = Number(state?.suggestedMinimum || 0);
  const maximumAllowed = Number(state?.maximumAllowed);
  const hasMaximumAllowed =
    state?.maximumAllowed !== null &&
    state?.maximumAllowed !== undefined &&
    Number.isFinite(maximumAllowed);
  const quickBidDisabled =
    bidding || !isOpen || isBestBidder || !hasCompatiblePayment;
  const noCompatiblePaymentMessage =
    state && !hasCompatiblePayment
      ? "No tenés un medio de pago verificado compatible con esta subasta."
      : "";
  const countdownText = isFinished
    ? "Subasta finalizada"
    : isOpen && remainingSeconds !== null
      ? `Este artículo cierra en: ${formatRemaining(remainingSeconds)}`
      : isUpcoming && remainingSeconds !== null
        ? `Esta subasta comienza en: ${formatRemaining(remainingSeconds)}`
        : "";

  const finishedMessage = isFinished
    ? state?.winner
      ? isBestBidder
        ? "Ganaste esta subasta."
        : `La subasta finalizó. Ganador: ${state.winner.postor || state.winner.email || "usuario ganador"}.`
      : "La subasta finalizó sin pujas."
    : "";
  const recentBids = (state?.recentBids || []).slice(0, 3);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Text style={styles.backArrow}>{"<"}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Sala de Subasta</Text>
          <View style={styles.liveIndicator}>
            <Text style={styles.liveDot}>{"●"}</Text>
            <Text style={styles.liveText}>EN VIVO</Text>
          </View>
        </View>

        {countdownText ? (
          <View style={styles.countdownCard}>
            <Text style={styles.countdownText}>{countdownText}</Text>
          </View>
        ) : null}

        {!isConnected ? (
          <ErrorBanner message="Sin conexión. Revisá tu internet antes de pujar." />
        ) : null}
        <ErrorBanner message={error} />
        <ErrorBanner message={noCompatiblePaymentMessage} type="info" />
        <ErrorBanner message={finishedMessage} type="info" />
        <ErrorBanner message={message} type="info" />

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : state ? (
          <>
            <View style={styles.card}>
              <View style={styles.lotRow}>
                {state.currentLot.imagenUrl ? (
                  <Image
                    source={{ uri: state.currentLot.imagenUrl }}
                    style={styles.lotThumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.lotThumb}>
                    <Text style={styles.lotThumbText}>{"IMG"}</Text>
                  </View>
                )}
                <View style={styles.lotInfo}>
                  <Text style={styles.lotTitle}>{state.currentLot.titulo}</Text>
                  <Text style={styles.lotMeta}>
                    {state.currentLot.numeroPieza} {" - "} {currency}
                  </Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() => setShowDetails((value) => !value)}
                  style={styles.detailsToggleButton}
                >
                  <Text style={styles.detailsToggleText}>
                    {showDetails ? "Ocultar" : "Detalles"}
                  </Text>
                </Pressable>
              </View>

              {showDetails ? (
                <View style={styles.lotDetails}>
                  <Text style={styles.lotMeta}>
                    {state.auction.titulo} {" - "} {currency} {" - "} Buenos Aires
                  </Text>
                  <Text style={styles.lotMeta}>
                    Estado: {formatStatus(state.auction.estado)}
                  </Text>
                  {state.currentLot.descripcion ? (
                    <Text style={styles.lotDescription}>
                      {state.currentLot.descripcion}
                    </Text>
                  ) : null}
                  {state.winner ? (
                    <Text style={styles.lotMeta}>
                      Ganador: {state.winner.postor || state.winner.email}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.bestOfferLabel}>Mejor oferta actual</Text>
              <Text style={styles.bestOfferAmount}>
                {currency}{" "}
                {bestBidAmount.toLocaleString("es-AR", {
                  minimumFractionDigits: 0,
                })}
              </Text>
              <Text style={styles.bestOfferIncrement}>
                Incremento mínimo sugerido: {currency}{" "}
                {suggestedMin.toLocaleString("es-AR", {
                  minimumFractionDigits: 0,
                })}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Realizar puja</Text>

              <Text style={styles.fieldLabel}>Ingresá monto</Text>
              <View style={styles.amountInputRow}>
                <View style={styles.currencyPrefix}>
                  <Text style={styles.currencyPrefixText}>{currency}</Text>
                </View>
                <TextInput
                  keyboardType="numeric"
                  onChangeText={setAmount}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={styles.amountInput}
                  value={amount}
                />
              </View>

              <Text style={styles.fieldLabel}>Puja rápida</Text>
              <View style={styles.quickBidRow}>
                <Pressable
                  disabled={quickBidDisabled}
                  onPress={() => handlePresetBid(suggestedMin)}
                  style={[
                    styles.quickBidButton,
                    quickBidDisabled && styles.quickBidButtonDisabled,
                  ]}
                >
                  <Text style={styles.quickBidText}>
                    Puja mínima ({formatBidAmountLabel(suggestedMin)})
                  </Text>
                </Pressable>
                {hasMaximumAllowed ? (
                  <Pressable
                    disabled={quickBidDisabled}
                    onPress={() => handlePresetBid(maximumAllowed)}
                    style={[
                      styles.quickBidButton,
                      quickBidDisabled && styles.quickBidButtonDisabled,
                    ]}
                  >
                    <Text style={styles.quickBidText}>
                      Puja máxima ({formatBidAmountLabel(maximumAllowed)})
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              <AppButton
                disabled={
                  bidding || !isOpen || isBestBidder || !hasCompatiblePayment
                }
                onPress={() => handleBid()}
                title={
                  isFinished
                    ? "Subasta finalizada"
                    : !isOpen
                      ? "Subasta no abierta"
                      : bidding
                        ? "Enviando puja..."
                        : "Realizar puja"
                  }
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Últimas pujas</Text>
              {recentBids.length ? (
                recentBids.map((bid) => (
                  <View key={bid.id} style={styles.bidRow}>
                    <Text style={styles.bidUser}>Usuario {bid.postor}</Text>
                    <Text style={styles.bidAmount}>
                      {currency}{" "}
                      {Number(bid.monto).toLocaleString("es-AR", {
                        minimumFractionDigits: 0,
                      })}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.meta}>
                  Todavía no hay pujas.
                </Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
      <BottomNav active="Auctions" navigation={navigation} />

      <Modal
        animationType="fade"
        onRequestClose={() => setWinModal(null)}
        transparent
        visible={Boolean(winModal)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>🎉</Text>
            <Text style={styles.modalTitle}>¡Ganaste el artículo!</Text>
            <Text style={styles.modalText}>
              Felicitaciones, ganaste "{winModal?.lotTitle}". La venta quedó
              registrada y vas a recibir el detalle con el importe y las
              comisiones.
            </Text>
            {winModal?.moreProducts ? (
              <AppButton
                onPress={() => setWinModal(null)}
                title="Seguir en la subasta"
              />
            ) : null}
            <AppButton
              onPress={() => {
                setWinModal(null);
                navigation.navigate("Activity");
              }}
              title="Ir a mi actividad"
              variant={winModal?.moreProducts ? "secondary" : "primary"}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backArrow: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: "700",
  },
  headerTitle: {
    color: colors.text,
    flex: 1,
    fontSize: typography.subtitle,
    fontWeight: "900",
  },
  liveIndicator: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  liveDot: {
    color: colors.danger,
    fontSize: 10,
  },
  liveText: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: "800",
  },
  countdownCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  countdownText: {
    color: colors.white,
    fontSize: typography.subtitle,
    fontWeight: "900",
    textAlign: "center",
  },
  detailsToggleButton: {
    alignSelf: "center",
    borderColor: colors.primary,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  detailsToggleText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: "800",
  },
  lotDetails: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 4,
    paddingTop: spacing.sm,
  },
  lotDescription: {
    color: colors.text,
    fontSize: typography.small,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: typography.subtitle,
    fontWeight: "900",
  },
  meta: {
    color: colors.muted,
    fontSize: typography.body,
  },
  lotRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  lotThumb: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  lotThumbText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  lotInfo: {
    flex: 1,
    gap: 2,
  },
  lotTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  lotMeta: {
    color: colors.muted,
    fontSize: typography.small,
  },
  bestOfferLabel: {
    color: colors.muted,
    fontSize: typography.body,
    textAlign: "center",
  },
  bestOfferAmount: {
    color: colors.primary,
    fontSize: 32,
    fontWeight: "900",
    textAlign: "center",
  },
  bestOfferIncrement: {
    color: colors.muted,
    fontSize: typography.small,
    textAlign: "center",
  },
  bidRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  bidUser: {
    color: colors.text,
    fontSize: typography.body,
  },
  bidAmount: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
  fieldLabel: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "700",
  },
  amountInputRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  currencyPrefix: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomLeftRadius: radius.md,
    borderColor: colors.border,
    borderRightWidth: 0,
    borderTopLeftRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  currencyPrefixText: {
    color: colors.muted,
    fontSize: typography.body,
    fontWeight: "700",
  },
  amountInput: {
    backgroundColor: colors.white,
    borderBottomRightRadius: radius.md,
    borderColor: colors.border,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  quickBidRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  quickBidButton: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  quickBidButtonDisabled: {
    opacity: 0.55,
  },
  quickBidText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: "700",
    textAlign: "center",
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    gap: spacing.sm,
    maxWidth: 380,
    padding: spacing.lg,
    width: "100%",
  },
  modalEmoji: {
    fontSize: 40,
    textAlign: "center",
  },
  modalTitle: {
    color: colors.primary,
    fontSize: typography.title,
    fontWeight: "900",
    textAlign: "center",
  },
  modalText: {
    color: colors.text,
    fontSize: typography.body,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
});
