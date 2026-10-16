package dev.atuy1219.gakumas.progresscapture;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Shared Material 3 visual system for ALL module screens. Uses system dynamic
 * color tokens (Android 12+) and contrast-aware fallbacks on older devices.
 * Source-only Android views; not the separate Google Material Components library.
 */
final class CaptureUi {
    private CaptureUi() {}

    interface TabListener { void selected(int index); }
    interface SelectionListener { void selected(int index); }

    static int dp(Activity c, int n) {
        return Math.round(n * c.getResources().getDisplayMetrics().density);
    }
    static boolean dark(Activity c) {
        return (c.getResources().getConfiguration().uiMode &
            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }
    private static int system(Activity c, String name, int fallback) {
        if (Build.VERSION.SDK_INT >= 31) {
            int id = c.getResources().getIdentifier(name, "color", "android");
            if (id != 0) return c.getResources().getColor(id, c.getTheme());
        }
        return fallback;
    }
    static int surface(Activity c) {
        return dark(c) ? system(c,"system_neutral1_900",0xff141218)
                       : system(c,"system_neutral1_10",0xfffff7fd);
    }
    static int surfaceContainer(Activity c) {
        return dark(c) ? system(c,"system_neutral1_800",0xff242128)
                       : system(c,"system_neutral1_50",0xfff4edf5);
    }
    static int surfaceContainerHigh(Activity c) {
        return dark(c) ? system(c,"system_neutral1_700",0xff302d35)
                       : system(c,"system_neutral1_100",0xffeee7ef);
    }
    static int onSurface(Activity c) { return dark(c) ? 0xffe8e0e9 : 0xff201a20; }
    static int onSurfaceVariant(Activity c) { return dark(c) ? 0xffcbc3ce : 0xff514852; }
    static int primary(Activity c) {
        return dark(c) ? system(c,"system_accent1_100",0xffd2bcff)
                       : system(c,"system_accent1_600",0xff6750a4);
    }
    static int onPrimary(Activity c) { return dark(c) ? 0xff26153f : Color.WHITE; }
    static int primaryContainer(Activity c) {
        return dark(c) ? system(c,"system_accent1_700",0xff4f378b)
                       : system(c,"system_accent1_100",0xffeaddff);
    }
    static int onPrimaryContainer(Activity c) { return dark(c) ? 0xfff0dbff : 0xff21005e; }

    // Retain compatibility for users of the earlier theme helpers.
    static int color(Activity c, String name) {
        if ("system_neutral1_10".equals(name)) return surface(c);
        if ("system_neutral1_800".equals(name)) return surfaceContainerHigh(c);
        if ("system_neutral1_900".equals(name)) return surfaceContainer(c);
        if ("system_accent1_500".equals(name)) return primary(c);
        return onSurface(c);
    }
    static GradientDrawable shape(int fill, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill); d.setCornerRadius(radius); return d;
    }
    private static RippleDrawable ripple(int bg, int radius, int rippleColor) {
        return new RippleDrawable(ColorStateList.valueOf(rippleColor),
                shape(bg,radius),shape(Color.WHITE,radius));
    }
    static TextView text(Activity c, String label, int size, boolean strong) {
        TextView t = new TextView(c);
        t.setText(label);
        t.setTextColor(onSurface(c));
        t.setTextSize(size);
        t.setLineSpacing(dp(c,2),1.0f);
        if (strong) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }
    static TextView secondary(Activity c, String label, int size) {
        TextView t=text(c,label,size,false);
        t.setTextColor(onSurfaceVariant(c));
        return t;
    }
    static LinearLayout root(Activity c) {
        LinearLayout root=new LinearLayout(c);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(surface(c));
        root.setPadding(dp(c,16),dp(c,16),dp(c,16),dp(c,28));
        return root;
    }
    static void applyWindow(Activity c, View fullScreenRoot) {
        Window w=c.getWindow();
        w.setStatusBarColor(surface(c));
        w.setNavigationBarColor(surface(c));
        int flags=w.getDecorView().getSystemUiVisibility();
        if (Build.VERSION.SDK_INT >= 23) {
            flags=dark(c)?flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                         :flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            flags=dark(c)?flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                         :flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        w.getDecorView().setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            fullScreenRoot.setOnApplyWindowInsetsListener((v,insets)->{
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                v.setPadding(0,bars.top,0,bars.bottom);
                return insets;
            });
            fullScreenRoot.requestApplyInsets();
        } else {
            fullScreenRoot.setFitsSystemWindows(true);
        }
    }
    static LinearLayout shell(Activity c) {
        LinearLayout shell=new LinearLayout(c);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(surface(c));
        return shell;
    }
    static void header(Activity c, LinearLayout shell, String title, String subtitle) {
        TextView heading=text(c,title,24,true);
        heading.setPadding(dp(c,20),dp(c,18),dp(c,20),0);
        shell.addView(heading);
        TextView sub=secondary(c,subtitle,13);
        sub.setPadding(dp(c,20),dp(c,4),dp(c,20),dp(c,12));
        shell.addView(sub);
    }
    static void tabs(Activity c, LinearLayout shell, int active, TabListener callback) {
        String[] titles={"記録","診断","設定"};
        LinearLayout bar=new LinearLayout(c);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(c,4),dp(c,4),dp(c,4),dp(c,4));
        bar.setBackground(shape(surfaceContainer(c),dp(c,24)));
        LinearLayout.LayoutParams blp=new LinearLayout.LayoutParams(-1,dp(c,56));
        blp.setMargins(dp(c,16),0,dp(c,16),dp(c,12));
        shell.addView(bar,blp);
        for (int i=0;i<titles.length;i++) {
            final int tab=i;
            boolean selected=i==active;
            TextView item=text(c,titles[i],14,selected);
            item.setGravity(Gravity.CENTER);
            item.setSingleLine(true);
            item.setTextColor(selected?onPrimaryContainer(c):onSurfaceVariant(c));
            item.setBackground(ripple(selected?primaryContainer(c):surfaceContainer(c),
                dp(c,20),0x336750a4));
            item.setSelected(selected);
            item.setContentDescription(titles[i]+(selected?"、選択中":""));
            item.setOnClickListener(v->callback.selected(tab));
            LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-1,1f);
            if(i>0)lp.leftMargin=dp(c,4);
            bar.addView(item,lp);
        }
    }
    static LinearLayout scrollContent(Activity c, LinearLayout shell) {
        ScrollView scroll=new ScrollView(c);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        LinearLayout content=root(c);
        scroll.addView(content);
        shell.addView(scroll,new LinearLayout.LayoutParams(-1,0,1f));
        return content;
    }
    static LinearLayout card(Activity c, LinearLayout parent, String title, String description) {
        LinearLayout card=new LinearLayout(c);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(c,18),dp(c,18),dp(c,18),dp(c,18));
        card.setBackground(shape(surfaceContainer(c),dp(c,28)));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.bottomMargin=dp(c,14);
        parent.addView(card,lp);
        TextView heading=text(c,title,19,true);
        card.addView(heading);
        if(description!=null && !description.isEmpty()) {
            TextView details=secondary(c,description,14);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);
            p.topMargin=dp(c,8);p.bottomMargin=dp(c,8);
            card.addView(details,p);
        }
        return card;
    }
    static Button button(Activity c, LinearLayout parent, String label, Runnable action) {
        return button(c,parent,label,action,false);
    }
    static Button button(Activity c, LinearLayout parent, String label, Runnable action, boolean primaryAction) {
        Button b=new Button(c);
        b.setAllCaps(false);
        b.setText(label);b.setTextSize(14);
        b.setMinHeight(dp(c,48));
        b.setGravity(Gravity.CENTER);
        b.setTextColor(primaryAction?onPrimary(c):onSurface(c));
        if (primaryAction) b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        int bg=primaryAction?primary(c):surfaceContainerHigh(c);
        b.setBackground(ripple(bg,dp(c,24),0x446750a4));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(c,48));
        lp.topMargin=dp(c,8);
        parent.addView(b,lp);
        b.setOnClickListener(v->action.run());
        return b;
    }
    static void info(Activity c, LinearLayout parent, String value) {
        TextView t=secondary(c,value,14);
        t.setPadding(dp(c,16),dp(c,14),dp(c,16),dp(c,14));
        t.setBackground(shape(surfaceContainerHigh(c),dp(c,20)));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.bottomMargin=dp(c,16);
        parent.addView(t,lp);
    }
    static void confirm(Activity c, String title, String message, String yes, Runnable action) {
        showDialog(c,title,message,new String[]{"キャンセル",yes},index->{if(index==1)action.run();});
    }
    static void choose(Activity c, String title, String[] labels, SelectionListener onChoose) {
        showDialog(c,title,null,labels,onChoose);
    }
    static void showDialog(Activity c, String title, String description,
                           String[] actions, SelectionListener callback) {
        Dialog d=new Dialog(c);
        LinearLayout body=new LinearLayout(c);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(c,24),dp(c,24),dp(c,24),dp(c,20));
        body.setBackground(shape(surfaceContainerHigh(c),dp(c,28)));
        TextView h=text(c,title,21,true);
        body.addView(h);
        if(description!=null&&!description.isEmpty()) {
            TextView sub=secondary(c,description,14);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);
            p.topMargin=dp(c,10);p.bottomMargin=dp(c,12);
            body.addView(sub,p);
        }
        for(int i=0;i<actions.length;i++){
            final int index=i;
            TextView item=text(c,actions[i],14,i==actions.length-1);
            item.setMinHeight(dp(c,48));
            item.setGravity(Gravity.CENTER_VERTICAL);
            item.setPadding(dp(c,16),dp(c,10),dp(c,12),dp(c,10));
            item.setBackground(ripple(surfaceContainer(c),dp(c,16),0x336750a4));
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);
            p.topMargin=dp(c,8);
            body.addView(item,p);
            item.setOnClickListener(v->{d.dismiss();callback.selected(index);});
        }
        ScrollView sc=new ScrollView(c);
        sc.setFillViewport(false);
        sc.addView(body);
        d.setContentView(sc);
        Window w=d.getWindow();
        if (w!=null)w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        d.show();
        if(d.getWindow()!=null){
            int width=c.getResources().getDisplayMetrics().widthPixels-dp(c,44);
            d.getWindow().setLayout(width,WindowManager.LayoutParams.WRAP_CONTENT);
            d.getWindow().setDimAmount(0.35f);
            d.getWindow().addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        }
    }
}
