package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Small source-owned, dynamic-color, Material 3-style view primitives.
 * No binary Android UI/Dex assets are copied from a different APK.
 */
final class CaptureUi {
    private CaptureUi() {}
    static int dp(Activity c, int value) {
        return Math.round(value * c.getResources().getDisplayMetrics().density);
    }
    static boolean dark(Activity c) {
        return (c.getResources().getConfiguration().uiMode &
            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }
    static int color(Activity c, String name) {
        if (Build.VERSION.SDK_INT >= 31) {
            int id = c.getResources().getIdentifier(name, "color", "android");
            if (id != 0) return c.getResources().getColor(id, c.getTheme());
        }
        boolean d = dark(c);
        switch(name) {
            case "system_accent1_500": return d ? 0xffc5c4ff : 0xff5351a2;
            case "system_neutral1_10": return d ? 0xff17171c : 0xfffdfbff;
            case "system_neutral1_800": return d ? 0xff34343f : 0xffe8e7ef;
            case "system_neutral1_900": return d ? 0xff303039 : 0xfff2f0f7;
            default: return d ? 0xfff0eff7 : 0xff1b1b22;
        }
    }
    static GradientDrawable shape(int color, int radiusPx) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color); d.setCornerRadius(radiusPx); return d;
    }
    static TextView text(Activity c, String value, int size, boolean strong) {
        TextView t = new TextView(c);
        t.setText(value); t.setTextSize(size);
        t.setTextColor(dark(c) ? 0xfff4f2fb : 0xff22212a);
        if (strong) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }
    static LinearLayout root(Activity c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(c,18),dp(c,18),dp(c,18),dp(c,26));
        l.setBackgroundColor(color(c,"system_neutral1_10"));
        return l;
    }
    static LinearLayout card(Activity c, LinearLayout parent, String title, String description) {
        LinearLayout outer = new LinearLayout(c);
        outer.setOrientation(LinearLayout.VERTICAL);
        int p=dp(c,16);
        outer.setPadding(p,p,p,p);
        outer.setBackground(shape(color(c,"system_neutral1_900"),dp(c,22)));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.bottomMargin=dp(c,12);
        parent.addView(outer,lp);
        TextView t=text(c,title,18,true);
        outer.addView(t);
        if(description!=null&&!description.isEmpty()) {
            TextView d=text(c,description,13,false);
            d.setAlpha(.80f);
            LinearLayout.LayoutParams dl=new LinearLayout.LayoutParams(-1,-2);
            dl.topMargin=dp(c,6);dl.bottomMargin=dp(c,10);
            outer.addView(d,dl);
        }
        return outer;
    }
    static Button button(Activity c, LinearLayout parent, String label, Runnable click) {
        Button b = new Button(c);
        b.setText(label); b.setAllCaps(false); b.setTextSize(14);
        int fg=dark(c)?0xfff4f2ff:0xff252234;
        b.setTextColor(fg);
        GradientDrawable bg=shape(color(c,"system_neutral1_800"),dp(c,16));
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x443333aa),bg,null));
        b.setMinHeight(dp(c,48));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.topMargin=dp(c,6);parent.addView(b,lp);
        b.setOnClickListener(v->click.run());
        return b;
    }
}
