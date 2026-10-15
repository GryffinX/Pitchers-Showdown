import React, { useState, useEffect, useCallback, useRef } from "react";
import "../styles/InvestorPopup.css"
import { useParams } from "react-router-dom";
import { fetchBusinessById, investInTeam } from "../../lib/api";
import useAuthStore from "../../lib/store";
import GameToast from "../components/GameToast";

// Messages for failed investments, based on what the API actually returns
const investErrorMessage = (status, data) => {
    if (status === 401 || status === 403) return "Your session has ended. Please log in again.";
    if (status === 404) return "This team is no longer available.";
    if (status >= 500) return "The server ran into a problem. Please try again.";
    return (data && (data.error || data.message)) || "The investment could not be completed.";
};

export default function BusinessPage() {
    const { teamId } = useParams();
    const [team, setTeam] = useState(null);

    const token = useAuthStore(store => store.auth.user)
    const balance = useAuthStore(store => store.balance)
    const { setBalance } = useAuthStore()
    const [amount, setAmount] = useState(0)
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState(null);
    const toastId = useRef(0);
    const closeToast = useCallback(() => setToast(null), []);
    const showToast = (type, title, message) => setToast({ id: ++toastId.current, type, title, message });

    useEffect(() => {
    async function loadBusiness() {
        try {
            const teamData = await fetchBusinessById(teamId);
        setTeam(teamData);
        setError("");
        } catch {
        setError("Failed to load business info.");
        }
    }
    loadBusiness();
    }, [teamId]);

    const isValidAmount = () => {
        if (!amount) return false;
        const num = Number(amount);
        return num <= balance;
    };

    async function handleInvest() {
        setError("");
        if (loading) return;
        if (!isValidAmount()) {
            setError("Please enter a valid amount within your purse and team's remaining amount.");
            return;
        }
        const amt = Number(amount);
        setLoading(true);
        let res;
        try {
            res = await investInTeam({ teamId, amount: amt, token });
        } catch {
            showToast("error", "Investment failed", "Could not reach the server. Check your connection and try again.");
            setLoading(false);
            return;
        }
        const data = await res.json().catch(() => null);
        setLoading(false);

        // Success only when the server confirms it
        if (!res.ok) {
            showToast("error", "Investment failed", investErrorMessage(res.status, data));
            return;
        }
        setAmount("");
        setBalance(typeof data?.balance === "number" ? data.balance : balance - amt);
        const teamName = data?.team || team?.team_name;
        showToast("success", "Investment successful!", `You invested ₹${amt.toLocaleString("en-IN")}${teamName ? ` in ${teamName}` : ""}.`);
    }

    return (
    <div className="flex flex-col justify-center items-center h-screen">
        <GameToast toast={toast} onClose={closeToast} />
        {team ? (
            <>
            <div className="investment-popup-bg">
                <div
                className="investment-popup-bubble"
                onClick={e => e.stopPropagation()}
                >
                <h1 className="text-black" style={{ margin: 0, fontWeight: 600, fontSize: "1.4rem" }}>Team {team.team_name}</h1>
                <form
                    className="investment-popup-form"
                    onSubmit={e => {
                    e.preventDefault();
                    handleInvest();
                    }}
                >
                    <input
                    type="number"
                    min="1"
                    max={balance}
                    placeholder="Enter Amount"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    disabled={loading}
                    autoFocus
                    />
                    <button
                    type="submit"
                    disabled={!isValidAmount() || loading}
                    >
                    {loading ? "Investing..." : "Invest"}
                    </button>
                </form>
                {team && (
                    <div className="remaining-amount-label">
                    Remaining Amount: {balance}/-
                    </div>
                )}
                {error && (
                    <div className="error-message" style={{ marginTop: 8 }}>
                    {error}
                    </div>
                )}
                </div>
            </div>
            </>
        ) : error ? (
            <p>{error}</p>
        ) : (
            <p>Loading...</p>
        )}
    </div>
    );
}
